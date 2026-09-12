import { useMemo } from "react";
import { useSettings } from "./context/SettingsContext";
import {
  useAuthSession,
  extractErrorMessage,
  createStructureApi,
  createBiophysicsApi,
  createClinicalApi,
  createSystemApi
} from "./api";

export { extractErrorMessage };

export function useApiClient() {
  const { settings } = useSettings();
  const { fetchWithAuth } = useAuthSession();

  const apiClient = useMemo(() => {
    return {
      ...createStructureApi(fetchWithAuth),
      ...createBiophysicsApi(fetchWithAuth),
      ...createClinicalApi(fetchWithAuth),
      ...createSystemApi(fetchWithAuth),
      settings
    };
  }, [fetchWithAuth, settings]);

  return { fetchWithAuth, apiClient };
}
