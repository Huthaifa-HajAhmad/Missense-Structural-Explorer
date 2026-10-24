export function getVariantStyles(isDark: boolean) {
  const classRoot = "bg-cs-bg text-cs-text-primary";
  const classHeader = "bg-cs-surface border-cs-border-subtle shadow-sm";
  const classHeaderTitle = "text-cs-text-primary";
  const classHeaderSub = "text-cs-text-muted";

  const classCard = "bg-cs-surface border border-cs-border shadow-cs-shadow-card rounded-xl";
  const classCardHeader = "text-cs-text-primary pb-3 border-b border-cs-border-subtle";
  const classCardTitle = "text-cs-text-primary";
  const classCardSubText = "text-cs-text-secondary";
  const classTextMute = "text-cs-text-muted";
  const classTextBody = "text-cs-text-secondary";
  const classTextBright = "text-cs-text-primary font-bold";
  const classBorderSec = "border-cs-border-subtle/60";
  const classBorderCardSep = "border-cs-border";

  const classBadgeAccent = "bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20";
  const classSubCard = "bg-cs-surface-2/60 border-cs-border-subtle/60 text-cs-text-secondary";

  return {
    classRoot,
    classHeader,
    classHeaderTitle,
    classHeaderSub,
    classCard,
    classCardHeader,
    classCardTitle,
    classCardSubText,
    classTextMute,
    classTextBody,
    classTextBright,
    classBorderSec,
    classBorderCardSep,
    classBadgeAccent,
    classSubCard
  };
}
