export type {
  EnergeticsData,
  EsmcPreference,
  EsmcLocalShift,
  EsmcEvalResult,
  LandscapeResidueItem,
  StringInteractionItem,
  Esm3EvalResult,
  Esm2ScoreData,
  BiophysicalModelingData,
  LanguageModelEvaluations,
  PpiBindingData,
  MultimerData
} from "../shared/contracts.ts";

export interface BiophysicalApiResponse {
  biochemicalShift: string;
  structuralImpact: string;
}

export interface BiophysicsConditions {
  ph: number;
  temperature: number; // °C
  ionicStrength: number; // mM
}
