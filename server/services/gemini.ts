import { GoogleGenAI, Type } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(customApiKey?: string): GoogleGenAI {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  
  if (customApiKey) {
    return new GoogleGenAI({
      apiKey: customApiKey,
      httpOptions: {
        timeout: 30000,
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        timeout: 30000,
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

export async function performGeminiAnalysis(
  gene: string,
  variant: string,
  uniprotId: string,
  residueIndex: string,
  wildType: string,
  mutant: string,
  userDirections: string | undefined,
  customApiKey: string | undefined,
  timeoutSignal: AbortSignal
) {
  const client = getGeminiClient(customApiKey);

  let userFocusInstructions = "";
  if (userDirections && userDirections.trim()) {
    userFocusInstructions = `
[CLINICIAN CUSTOM INSTRUCTIONS / FOCUS AREAS]:
The user has requested to prioritize or focus on the following aspects:
"${userDirections.trim()}"
Please incorporate these directions into your clinical and biophysical analysis.
`;
  }

  const prompt = `You are an expert computational structural biologist and clinical geneticist.
Analyze the following missense variant:
- Gene Symbol: ${gene}
- Amino Acid Mutation: ${variant}
- UniProt Accession ID: ${uniprotId}
${residueIndex ? `- Position of Mutation: Residue #${residueIndex} (Wild-Type: ${wildType}, Mutant: ${mutant})` : ""}
${userFocusInstructions}

Please perform both a detailed clinical and biophysical narrative analysis and generate a highly compact structured report.

For the narrative analysis (returned in the "analysis" field), write a highly detailed clinical and biophysical analysis of this mutation under these exact headers (using markdown formatting):

### 🧬 Molecular and Chemical Shift
Describe the wild-type residue (${wildType || "original"}) vs. the mutant residue (${mutant || "target"}). Contrast their chemical classes (e.g., aliphatic, aromatic, charged, polar, hydrophobic), molecular volumes, charge states, and side-chain conformations.

### 🧱 Structural Context & Disruptive Potential
Explain how this substitution disrupts the structural integrity of the protein:
1. Does it clash sterically (especially if mutating to a bulkier residue like Trp, Phe)?
2. Does it break crucial hydrogen-bonding networks, salt bridges (e.g., loss of Arg/Lys positive charge), or hydrophobic packaging?
3. How might it affect local secondary structure (e.g., Proline/Glycine mutations disrupting alpha-helices)?
Provide specific molecular hypotheses based on peptide chain coordinates.

### 🏥 Clinical and Pathogenicity Interpretation
Synthesize an assessment of pathogenicity risk (Pathogenic, VUS, Benign) supported by known databases (ClinVar, gnomAD) and biological mechanisms:
- What clinical phenotypes or syndrome are associated with dysfunction of the ${gene} gene?
- What are the functional outcomes (e.g. loss-of-function, dominant-negative, or hyper-activation)?

### 🔬 Recommended 3D Visualization Landmarks
Suggest 2-3 specific features for the clinical investigator to look for in the 3D Mol* viewport:
- Which secondary structure element includes residue ${residueIndex || "the mutation site"}?
- Is this residue solvent-exposed (surface) or buried (core)?
- Is it near a known active site, interface, or lipid-membrane anchoring boundary?

For the structured report fields, provide compact, precise, and expert descriptions.`;

  const consolidatedResponse = await client.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis: {
            type: Type.STRING,
            description: "Highly detailed clinical and biophysical analysis of this mutation under the specified markdown headers. Must be formatted in markdown."
          },
          biochemicalShift: {
            type: Type.STRING,
            description: "Compact description of chemical shift (e.g., 'Substitution of positive hydrophilic Arg with a neutral bulky hydrophobic Trp (+55 Å³ expansion)')"
          },
          structuralImpact: {
            type: Type.STRING,
            description: "Short analysis of structural or free-energy impact (e.g., 'Steric packing clashes within helix backbone, predicted delta-delta G destabilization')"
          },
          pathogenicity: {
            type: Type.STRING,
            description: "Predicted pathogenicity class (must be exactly one of: Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign)"
          },
          acmgCriteria: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                code: { type: Type.STRING, description: "ACMG/AMP criteria code (e.g., 'PM1', 'PP3', 'PM2')" },
                reason: { type: Type.STRING, description: "Short justification for applying this criteria code in this specific context" }
              },
              required: ["code", "reason"]
            }
          }
        },
        required: ["analysis", "biochemicalShift", "structuralImpact", "pathogenicity", "acmgCriteria"]
      }
    }
  });

  let parsed = null;
  if (consolidatedResponse && consolidatedResponse.text) {
    parsed = JSON.parse(consolidatedResponse.text.trim());
  }

  if (!parsed) {
    throw new Error("Failed to generate or parse variant analysis results from Gemini API.");
  }

  return {
    analysis: parsed.analysis || "",
    insights: {
      biochemicalShift: parsed.biochemicalShift || "",
      structuralImpact: parsed.structuralImpact || "",
      pathogenicity: parsed.pathogenicity || "VUS",
      acmgCriteria: parsed.acmgCriteria || []
    }
  };
}
