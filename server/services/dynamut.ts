import crypto from "crypto";
import https from "https";
import { fetchWithRetry } from "./http-client.ts";

export async function submitDynaMut2Job(
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string
): Promise<string | null> {
  const url = "https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single";
  const mutationCode = `${wtRes}${pos}${mutRes}`; // e.g. R408W
  console.log(`[DynaMut2 API] Preparing to submit single mutation job for ${mutationCode} on chain ${chain}...`);

  try {
    const formData = new FormData();
    formData.append("mutation", mutationCode);
    formData.append("chain", chain || "A");
    formData.append("pdb_file", new Blob([pdbText], { type: "text/plain" }), "wt.pdb");

    const response = await fetchWithRetry(url, {
      method: "POST",
      body: formData,
      timeout: 20000
    });

    if (!response.ok) {
      throw new Error(`Submit job failed (status: ${response.status})`);
    }

    const data = await response.json() as any;
    const jobId = data.job_id;
    if (!jobId) {
      throw new Error("API response did not contain a job_id.");
    }
    console.log(`[DynaMut2 API] Job submitted successfully. Job ID: ${jobId}`);
    return String(jobId);
  } catch (err: any) {
    console.error(`[DynaMut2 API] Error during submission:`, err.message);
    return null;
  }
}

export async function pollDynaMut2Job(
  jobId: string
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; prediction: number | null } | null> {
  const url = "https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single";
  try {
    const pollUrl = `${url}?job_id=${jobId}`;
    const pollRes = await fetchWithRetry(pollUrl, {
      method: "GET",
      timeout: 10000
    });

    if (!pollRes.ok) {
      console.warn(`[DynaMut2 API] Polling request failed for job ${jobId} (status: ${pollRes.status})`);
      if (pollRes.status === 429) {
        const rateLimitErr = new Error("DynaMut2 upstream rate limit reached");
        (rateLimitErr as any).statusCode = 429;
        throw rateLimitErr;
      }
      return { status: "ERROR", prediction: null };
    }

    const pollJson = await pollRes.json() as any;
    if (pollJson.prediction !== undefined && pollJson.prediction !== null) {
      const ddG = parseFloat(pollJson.prediction);
      console.log(`[DynaMut2 API] Prediction completed for job ${jobId}: ${ddG} kcal/mol`);
      return { status: "DONE", prediction: isNaN(ddG) ? null : ddG };
    }

    // Check if explicitly running, queued, or missing prediction/error
    if (
      pollJson.status === "RUNNING" ||
      pollJson.message === "RUNNING" ||
      pollJson.status === "QUEUED" ||
      (pollJson.prediction === undefined && !pollJson.error)
    ) {
      return { status: "RUNNING", prediction: null };
    }

    console.warn(`[DynaMut2 API] Polling returned error or unexpected format:`, pollJson);
    return { status: "ERROR", prediction: null };
  } catch (err: any) {
    console.error(`[DynaMut2 API] Error polling job ${jobId}:`, err.message);
    if (err.statusCode === 429) {
      throw err;
    }
    return { status: "ERROR", prediction: null };
  }
}

export async function submitDdmutJob(
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string
): Promise<string | null> {
  const url = "https://biosig.lab.uq.edu.au/ddmut/api/prediction_single";
  const mutationCode = `${wtRes}${pos}${mutRes}`; // e.g. R408W
  console.log(`[DDMut API] Preparing to submit single mutation job for ${mutationCode} on chain ${chain}...`);

  try {
    const formData = new FormData();
    formData.append("mutation", mutationCode);
    formData.append("chain", chain || "A");
    formData.append("pdb_file", new Blob([pdbText], { type: "text/plain" }), "wt.pdb");

    const response = await fetchWithRetry(url, {
      method: "POST",
      body: formData,
      timeout: 20000
    });

    if (!response.ok) {
      throw new Error(`Submit job failed (status: ${response.status})`);
    }

    const data = await response.json() as any;
    const jobId = data.job_id;
    if (!jobId) {
      throw new Error("API response did not contain a job_id.");
    }
    console.log(`[DDMut API] Job submitted successfully. Job ID: ${jobId}`);
    return String(jobId);
  } catch (err: any) {
    console.error(`[DDMut API] Error during submission:`, err.message);
    return null;
  }
}

export async function pollDdmutJob(
  jobId: string
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; prediction: number | null } | null> {
  const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="job_id"\r\n\r\n${jobId}\r\n--${boundary}--\r\n`;

  console.log(`[DDMut API] Polling status for job ${jobId} using GET with multipart form-data...`);

  return new Promise((resolve) => {
    const options = {
      hostname: "biosig.lab.uq.edu.au",
      port: 443,
      path: "/ddmut/api/prediction_single",
      method: "GET",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(body)
      },
      rejectUnauthorized: false,
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            console.warn(`[DDMut API] Polling failed (status: ${res.statusCode})`);
            resolve({ status: "ERROR", prediction: null });
            return;
          }
          const pollJson = JSON.parse(data);
          if (pollJson.prediction !== undefined && pollJson.prediction !== null) {
            const ddG = parseFloat(pollJson.prediction);
            console.log(`[DDMut API] Prediction completed for job ${jobId}: ${ddG} kcal/mol`);
            resolve({ status: "DONE", prediction: isNaN(ddG) ? null : ddG });
            return;
          }
          if (
            pollJson.status === "RUNNING" ||
            pollJson.message === "RUNNING" ||
            pollJson.status === "QUEUED" ||
            pollJson.message === "QUEUED"
          ) {
            resolve({ status: "RUNNING", prediction: null });
            return;
          }
          console.warn(`[DDMut API] Polling returned error or unexpected format:`, pollJson);
          resolve({ status: "ERROR", prediction: null });
        } catch (e: any) {
          console.error(`[DDMut API] Parse error during polling:`, e.message);
          resolve({ status: "ERROR", prediction: null });
        }
      });
    });

    req.on("error", (err: any) => {
      console.error(`[DDMut API] Network error during polling:`, err.message);
      resolve({ status: "ERROR", prediction: null });
    });

    req.write(body);
    req.end();
  });
}
