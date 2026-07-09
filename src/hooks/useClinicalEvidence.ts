import { useState } from "react";

export function useClinicalEvidence() {
  const [triageOverride, setTriageOverride] = useState<boolean>(false);

  return {
    triageOverride,
    setTriageOverride
  };
}
