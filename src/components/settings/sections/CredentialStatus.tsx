import type { useApiConnections } from "../../../hooks/useApiConnections";
import { PROVIDER_STATE_LABELS } from "../../../shared/providerStatus";
import { alphagenomeCard, geminiCard } from "../../telemetry/computeCards";
import { markOutOfDate } from "../../telemetry/serviceSummary";
import type { ServiceStatusCard } from "../../telemetry/serviceCardModel";
import { useServiceCardContext } from "../../telemetry/useServiceCardContext";

type GeminiLink = Pick<ReturnType<typeof useApiConnections>, "linking" | "linkError" | "linkGeminiKey">;

/**
 * The state of the services whose key is set on this page, read by the same functions as the
 * Analysis monitor's status panel, so a key field and the panel never disagree. The panel lists every
 * service; this page only says, next to each key, whether that key's service is working.
 */
export function useKeyFieldStatus(gemini: GeminiLink): { gemini: ServiceStatusCard; alphagenome: ServiceStatusCard } {
  // The reader is already on the page the cards would send them to, so their action does nothing here.
  const { ctx, stale } = useServiceCardContext({ configure: () => {}, gemini });
  const mark = (card: ServiceStatusCard) => (stale ? markOutOfDate(card) : card);
  return { gemini: mark(geminiCard(ctx)), alphagenome: mark(alphagenomeCard(ctx)) };
}

const DOT: Partial<Record<ServiceStatusCard["state"], string>> = {
  connected: "bg-[var(--cs-text-success)]",
  configured: "bg-[var(--cs-text-success)]",
  degraded: "bg-[var(--cs-text-warning)]",
  unreachable: "bg-[var(--cs-text-danger)]"
};

/** One line under a key field: the service's state word and where its key comes from. */
export function CredentialStatus({ card }: { card: ServiceStatusCard }) {
  // Card descriptions read "<what the service does> · <where its key comes from>"; only the source is new here.
  const parts = card.description.split(" · ");
  const source = parts.length > 1 ? parts[parts.length - 1] : null;
  return (
    <p
      className="flex items-center gap-1.5 px-4 mt-0.5 pb-3 text-[11px] text-cs-text-muted"
      data-testid={`credential-status-${card.id}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full shrink-0 ${DOT[card.state] ?? "bg-cs-border"}`} />
      <span>
        <span className="font-medium text-cs-text-secondary">{PROVIDER_STATE_LABELS[card.state]}</span>
        {source ? ` · ${source}` : ""}
      </span>
    </p>
  );
}
