import { Button, EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui";
import { QueueBoard } from "../../components/QueueBoard";
import { useQueueSocket } from "../../lib/useQueueSocket";
import { useActiveDoctor } from "./ActiveDoctorContext";
import { useCallNext, useDoctorQueue, useMarkComplete, useMarkNoShow, usePauseQueue } from "./hooks";
import { useT } from "../../lib/i18n";

export function QueueBoardPage() {
  const t = useT();
  const { doctorId } = useActiveDoctor();
  const { data: queue, isLoading, isError, refetch } = useDoctorQueue(doctorId);
  const callNext = useCallNext(doctorId);
  const markComplete = useMarkComplete(doctorId);
  const markNoShow = useMarkNoShow(doctorId);
  const pauseQueue = usePauseQueue(doctorId);
  const { connected } = useQueueSocket(doctorId);

  if (!doctorId) return <EmptyState icon="stethoscope" title={t("No doctor selected")} />;
  if (isLoading) return <Spinner />;
  if (isError || !queue) return <ErrorState message={t("Could not load the queue")} onRetry={() => refetch()} />;

  const isOpen = queue.status === "OPEN";

  return (
    <>
      <PageHeader eyebrow={t("Front desk")} title={t("Today's queue")} />
      <QueueBoard
        queue={queue}
        connected={connected}
        onCallNext={() => callNext.mutateAsync()}
        callNextPending={callNext.isPending}
        onComplete={(id) => markComplete.mutateAsync(id)}
        onNoShow={(id) => markNoShow.mutateAsync(id)}
        extraActions={(run) => (
          <Button
            size="lg"
            variant="outline"
            icon={isOpen ? "pause" : "play"}
            className="!text-white !ring-white/40 hover:!bg-white/10"
            loading={pauseQueue.isPending}
            onClick={() => run(() => pauseQueue.mutateAsync(isOpen ? "PAUSED" : "OPEN"))}
          >
            {isOpen ? t("Pause") : t("Resume")}
          </Button>
        )}
      />
    </>
  );
}
