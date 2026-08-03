import { UserSettings } from "../../types";

export interface ValidationStatus {
  valid: boolean;
  message: string;
}

export interface SettingsTabProps {
  isDark: boolean;
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

export interface ApiKeysTabProps extends SettingsTabProps {
  showApiKey: boolean;
  setShowApiKey: (show: boolean) => void;
  showAppToken: boolean;
  setShowAppToken: (show: boolean) => void;
  showBiohubToken: boolean;
  setShowBiohubToken: (show: boolean) => void;
  showTamarindToken: boolean;
  setShowTamarindToken: (show: boolean) => void;
  showHfToken: boolean;
  setShowHfToken: (show: boolean) => void;
  isLinking: boolean;
  linkError: string | null;
  setLinkError: (error: string | null) => void;
  biohubTesting: boolean;
  biohubValidationStatus: ValidationStatus | null;
  testBiohubToken: () => Promise<void>;
  tamarindTesting: boolean;
  tamarindValidationStatus: ValidationStatus | null;
  testTamarindToken: () => Promise<void>;
  hfTesting: boolean;
  hfValidationStatus: ValidationStatus | null;
  testHfToken: () => Promise<void>;
  handleLinkApiKey: () => Promise<void>;
}
