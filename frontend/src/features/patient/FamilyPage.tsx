import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Alert, Avatar, Button, Card, EmptyState, ErrorState, Field, Input, Section, Segmented, Select, Skeleton, stagger } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { msg, useT } from "../../lib/i18n";
import type { FamilyMember, FamilyRelationship } from "../../types/api";
import { useDeleteFamilyMember, useFamily, useSaveFamilyMember } from "./hooks";

const RELATIONSHIPS: { value: FamilyRelationship; label: string }[] = [
  { value: "CHILD", label: msg("Child") },
  { value: "PARENT", label: msg("Parent") },
  { value: "SPOUSE", label: msg("Spouse") },
  { value: "OTHER", label: msg("Other") },
];
const relationshipLabel = (r: FamilyRelationship) => RELATIONSHIPS.find((x) => x.value === r)?.label ?? r;

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Same rule as the server: under 18 by date of birth or age; a child with no age counts as a minor. */
function looksMinor(relationship: FamilyRelationship, ageMode: "age" | "dob", age: string, dob: string): boolean {
  if (ageMode === "dob" && dob) {
    const [y, m, d] = todayIso().split("-").map(Number);
    const [by, bm, bd] = dob.split("-").map(Number);
    return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0) < 18;
  }
  if (ageMode === "age" && age.trim() !== "") return Number(age) < 18;
  return relationship === "CHILD";
}

function ageText(m: FamilyMember, t: ReturnType<typeof useT>): string | null {
  if (m.dateOfBirth) return t("Born {date}", { date: m.dateOfBirth });
  if (m.ageYears != null) return t("Age {n}", { n: m.ageYears });
  return null;
}

/** Add or edit a family member. The account holder gives consent every time. */
function MemberForm({ member, onDone }: { member?: FamilyMember; onDone: () => void }) {
  const t = useT();
  const save = useSaveFamilyMember();
  const [fullName, setFullName] = useState(member?.fullName ?? "");
  const [relationship, setRelationship] = useState<FamilyRelationship>(member?.relationship ?? "CHILD");
  const [ageMode, setAgeMode] = useState<"age" | "dob">(member?.dateOfBirth ? "dob" : "age");
  const [age, setAge] = useState(member?.ageYears != null ? String(member.ageYears) : "");
  const [dob, setDob] = useState(member?.dateOfBirth ?? "");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = fullName.trim();
  const nameInvalid = name.length > 0 && name.length < 2;
  const ageInvalid = ageMode === "age" && age.trim() !== "" && !(Number.isInteger(Number(age)) && Number(age) >= 0 && Number(age) <= 120);
  const dobInvalid = ageMode === "dob" && dob !== "" && (dob > todayIso() || dob < "1900-01-01");
  const minor = looksMinor(relationship, ageMode, age, dob);
  const who = name || t("this person");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.length < 2 || ageInvalid || dobInvalid || !consent) return;
    setError(null);
    try {
      await save.mutateAsync({
        id: member?.id,
        fullName: name,
        relationship,
        ageYears: ageMode === "age" && age.trim() !== "" ? Number(age) : null,
        dateOfBirth: ageMode === "dob" && dob ? dob : null,
        consent: true,
      });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4" data-testid="family-form">
      <Field label={t("Full name")} error={nameInvalid ? t("Name must be at least 2 characters") : null}>
        <Input icon="user" autoComplete="off" placeholder={t("e.g. Asha Sharma")} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label={t("Relationship to you")}>
        <Select value={relationship} onChange={(e) => setRelationship(e.target.value as FamilyRelationship)}>
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {t(r.label)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="space-y-2">
        <span className="label">{t("Age or date of birth (optional)")}</span>
        <Segmented
          value={ageMode}
          onChange={setAgeMode}
          options={[
            { value: "age", label: t("Age") },
            { value: "dob", label: t("Date of birth") },
          ]}
        />
        {ageMode === "age" ? (
          <Field label={t("Age in years")} error={ageInvalid ? t("Enter an age between 0 and 120") : null}>
            <Input type="number" inputMode="numeric" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} />
          </Field>
        ) : (
          <Field label={t("Date of birth")} error={dobInvalid ? t("Enter a real date of birth, not in the future") : null}>
            <Input type="date" max={todayIso()} min="1900-01-01" value={dob} onChange={(e) => setDob(e.target.value)} />
          </Field>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-2xl bg-brand-50 p-3 text-sm text-ink ring-1 ring-brand-100" data-testid="family-consent">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          {minor
            ? t("I am {name}'s parent or legal guardian. As their guardian, I consent to MEDORA and the clinics they visit using their name, age and appointment details to book and manage their visits. Nothing about a child's location or behaviour is collected.", { name: who })
            : t("{name} has agreed that I may book for them and that MEDORA and the clinics they visit may use their name, age and appointment details to manage their visits.", { name: who })}{" "}
          <Link to="/privacy" className="font-semibold text-brand-600 underline">
            {t("Privacy policy")}
          </Link>
        </span>
      </label>

      <Alert>{error}</Alert>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          {t("Cancel")}
        </Button>
        <Button type="submit" icon="check" className="flex-1" disabled={name.length < 2 || ageInvalid || dobInvalid || !consent} loading={save.isPending}>
          {member ? t("Save") : t("Add")}
        </Button>
      </div>
    </form>
  );
}

function MemberCard({ member, index }: { member: FamilyMember; index: number }) {
  const t = useT();
  const remove = useDeleteFamilyMember();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [error, setError] = useState<string | null>(null);

  async function erase() {
    setError(null);
    try {
      await remove.mutateAsync(member.id);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <Card className="animate-fade-up space-y-3 p-4" style={stagger(index)}>
      <div className="flex items-center gap-3" data-testid="family-member">
        <Avatar name={member.fullName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-ink">{member.fullName}</p>
          <p className="text-sm text-muted">
            {[t(relationshipLabel(member.relationship)), ageText(member, t)].filter(Boolean).join(" · ")}
          </p>
          {member.isMinor && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-success">
              <Icon name="shield" className="h-3.5 w-3.5" /> {t("Under 18 · you consented as guardian")}
            </p>
          )}
        </div>
      </div>

      {mode === "view" && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => setMode("edit")}>
            {t("Edit")}
          </Button>
          <Button size="sm" variant="outline" className="flex-1 !text-danger !ring-danger/40" onClick={() => setMode("delete")}>
            {t("Remove")}
          </Button>
        </div>
      )}
      {mode === "edit" && <MemberForm member={member} onDone={() => setMode("view")} />}
      {mode === "delete" && (
        <div className="space-y-3 rounded-2xl bg-danger-soft p-3 text-sm text-ink">
          <p className="font-semibold text-danger">{t("Remove {name}? This cannot be undone.", { name: member.fullName })}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Their upcoming bookings are cancelled. Those 2+ hours away are refunded in full.")}</li>
            <li>{t("Their name, age and the messages about them are erased. Your account and other family members are not affected.")}</li>
          </ul>
          <Alert>{error}</Alert>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setMode("view")}>
              {t("Keep")}
            </Button>
            <Button variant="danger" className="flex-1" loading={remove.isPending} onClick={() => void erase()}>
              {t("Remove forever")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Profile → Family: the people this account books for. */
export function FamilyPage() {
  const t = useT();
  const { data: members, isLoading, isError, refetch } = useFamily();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-5">
      <Link to="/patient/profile" className="inline-flex items-center gap-1 text-sm font-semibold text-muted transition hover:text-brand-600">
        <Icon name="chevronLeft" className="h-4 w-4" /> {t("Profile")}
      </Link>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{t("Family")}</p>
        <h1 className="text-2xl font-extrabold">{t("Family members")}</h1>
        <p className="mt-1 text-sm text-muted">
          {t("Book for your parents, children or spouse from your account. Each person has their own bookings; reminders come to your phone with their name.")}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-24" />
      ) : isError ? (
        <ErrorState message={t("Could not load your family")} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-3">
          {members && members.length === 0 && !adding && (
            <EmptyState icon="users" title={t("No family members yet")} hint={t("Add someone to book appointments for them.")} />
          )}
          {members?.map((m, i) => <MemberCard key={m.id} member={m} index={i} />)}
        </div>
      )}

      {adding ? (
        <Section title={t("Add a family member")} icon="users">
          <MemberForm onDone={() => setAdding(false)} />
        </Section>
      ) : (
        <Button icon="users" className="w-full" onClick={() => setAdding(true)}>
          {t("Add a family member")}
        </Button>
      )}
    </div>
  );
}
