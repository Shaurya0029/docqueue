import type { FamilyRelationship, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { todayKey } from "./dates";
import { writeAuditLog } from "./audit";

/**
 * Family profiles. One login (the account holder) manages family members:
 * each is a separate Patient row with accountHolderId set and no login of
 * its own. Members can't manage anyone (no nesting). Messages about a member
 * go to the account holder's phone and name the member.
 */

/** Appointments the account holder may see and manage: their own and their family members'. */
export function ownedByAccount(holderId: string): Prisma.AppointmentWhereInput {
  return { OR: [{ patientId: holderId }, { patient: { accountHolderId: holderId } }] };
}

/** Select this on a patient to work out who to text and how to word it. */
export const contactSelect = {
  id: true,
  userId: true,
  fullName: true,
  accountHolderId: true,
  accountHolder: { select: { userId: true } },
} satisfies Prisma.PatientSelect;
export type ContactPatient = Prisma.PatientGetPayload<{ select: typeof contactSelect }>;

/** The login that receives this patient's messages: their own, or their account holder's. */
export function accountUserId(p: ContactPatient): string {
  const userId = p.userId ?? p.accountHolder?.userId;
  if (!userId) throw new Error(`patient ${p.id} has no account to contact`);
  return userId;
}

/**
 * Wording for a message about this patient. For the account holder it is
 * "you"/"your"; for a family member it names them, e.g. "Reminder for Asha".
 */
export interface Who {
  /** The family member's name, or null when the message is about the account holder. */
  name: string | null;
  /** "" or " for Asha", to follow a label like "Reminder". */
  forName: string;
  /** "your" or "Asha's". */
  your: string;
  /** "Your" or "Asha's". */
  Your: string;
  /** "You are" or "Asha is". */
  youAre: string;
}

export function whoFor(p: { accountHolderId: string | null; fullName: string | null }): Who {
  if (!p.accountHolderId) return { name: null, forName: "", your: "your", Your: "Your", youAre: "You are" };
  const name = p.fullName ?? "your family member";
  return { name, forName: ` for ${name}`, your: `${name}'s`, Your: `${name}'s`, youAre: `${name} is` };
}

export const ADULT_AGE = 18;

/**
 * Whether this patient is under 18. With only an age we add the whole years
 * since it was given (which can only under-count, so someone who may still
 * be 17 counts as a minor). A child with no age given is treated as a minor.
 */
export function isMinor(
  p: {
    dateOfBirth: string | null;
    ageYears: number | null;
    ageRecordedOn: string | null;
    relationship: FamilyRelationship | null;
    accountHolderId: string | null;
  },
  today = todayKey()
): boolean {
  if (!p.accountHolderId) return false; // account holders sign up themselves
  const [y, m, d] = today.split("-").map(Number);
  if (p.dateOfBirth) {
    const [by, bm, bd] = p.dateOfBirth.split("-").map(Number);
    const age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
    return age < ADULT_AGE;
  }
  if (p.ageYears != null && p.ageRecordedOn) {
    // Whole years since the age was given, counted only once each anniversary has passed.
    const [ry, rm, rd] = p.ageRecordedOn.split("-").map(Number);
    const elapsed = y - ry - (m < rm || (m === rm && d < rd) ? 1 : 0);
    return p.ageYears + elapsed < ADULT_AGE;
  }
  return p.relationship === "CHILD";
}

const memberSelect = {
  id: true,
  fullName: true,
  relationship: true,
  dateOfBirth: true,
  ageYears: true,
  ageRecordedOn: true,
  consentAt: true,
  consentSource: true,
  accountHolderId: true,
  createdAt: true,
} satisfies Prisma.PatientSelect;
type MemberRow = Prisma.PatientGetPayload<{ select: typeof memberSelect }>;

export function presentMember(m: MemberRow) {
  return {
    id: m.id,
    fullName: m.fullName,
    relationship: m.relationship,
    dateOfBirth: m.dateOfBirth,
    ageYears: m.ageYears,
    ageRecordedOn: m.ageRecordedOn,
    isMinor: isMinor(m),
    consent: { givenAt: m.consentAt, givenVia: m.consentSource },
    addedAt: m.createdAt,
  };
}

export async function listFamily(holderId: string) {
  const members = await prisma.patient.findMany({
    where: { accountHolderId: holderId, deletedAt: null },
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });
  return members.map(presentMember);
}

/** A live family member of this account holder, or 404 (never reveals other accounts' members). */
export async function assertFamilyMember(holderId: string, memberId: string) {
  const member = await prisma.patient.findFirst({ where: { id: memberId, accountHolderId: holderId, deletedAt: null }, select: memberSelect });
  if (!member) throw new HttpError(404, "Family member not found");
  return member;
}

/** Who a booking is for: the account holder (no id, or their own id) or one of their family members. */
export async function resolveBookingPatient(holderId: string, patientId: string | undefined): Promise<string> {
  if (!patientId || patientId === holderId) return holderId;
  return (await assertFamilyMember(holderId, patientId)).id;
}

export interface MemberInput {
  fullName: string;
  relationship: FamilyRelationship;
  dateOfBirth?: string | null;
  ageYears?: number | null;
}

type BirthFields = { dateOfBirth: string | null; ageYears: number | null; ageRecordedOn: string | null };

/** A date of birth wins if both are given; an age is kept with the day it was given. */
function birthFields(input: MemberInput): BirthFields {
  if (input.dateOfBirth) return { dateOfBirth: input.dateOfBirth, ageYears: null, ageRecordedOn: null };
  if (input.ageYears != null) return { dateOfBirth: null, ageYears: input.ageYears, ageRecordedOn: todayKey() };
  return { dateOfBirth: null, ageYears: null, ageRecordedOn: null };
}

/**
 * Consent is given by the account holder every time a member is added or
 * changed: as guardian for an under-18, or confirming an adult agreed.
 */
function consentFields(fields: { relationship: FamilyRelationship } & BirthFields, holderId: string) {
  const minor = isMinor({ ...fields, accountHolderId: holderId });
  return { consentAt: new Date(), consentSource: minor ? "guardian" : "account-holder" };
}

export const MAX_FAMILY_MEMBERS = 10;

export async function addFamilyMember(holderId: string, actorUserId: string, input: MemberInput) {
  const holder = await prisma.patient.findUniqueOrThrow({ where: { id: holderId } });
  if (holder.accountHolderId || !holder.userId) throw new HttpError(403, "Only an account holder can add family members");
  const count = await prisma.patient.count({ where: { accountHolderId: holderId, deletedAt: null } });
  if (count >= MAX_FAMILY_MEMBERS) throw new HttpError(409, `You can add up to ${MAX_FAMILY_MEMBERS} family members`);

  const birth = birthFields(input);
  const member = await prisma.patient.create({
    data: {
      accountHolderId: holderId,
      fullName: input.fullName.trim(),
      relationship: input.relationship,
      ...birth,
      ...consentFields({ relationship: input.relationship, ...birth }, holderId),
    },
    select: memberSelect,
  });
  await writeAuditLog({
    actorUserId,
    action: "FAMILY_MEMBER_ADDED",
    targetType: "Patient",
    targetId: member.id,
    metadata: { consentSource: member.consentSource },
  });
  return presentMember(member);
}

export async function updateFamilyMember(holderId: string, actorUserId: string, memberId: string, input: MemberInput) {
  await assertFamilyMember(holderId, memberId);
  const birth = birthFields(input);
  const member = await prisma.patient.update({
    where: { id: memberId },
    data: {
      fullName: input.fullName.trim(),
      relationship: input.relationship,
      ...birth,
      ...consentFields({ relationship: input.relationship, ...birth }, holderId),
    },
    select: memberSelect,
  });
  await writeAuditLog({
    actorUserId,
    action: "FAMILY_MEMBER_UPDATED",
    targetType: "Patient",
    targetId: member.id,
    metadata: { consentSource: member.consentSource },
  });
  return presentMember(member);
}
