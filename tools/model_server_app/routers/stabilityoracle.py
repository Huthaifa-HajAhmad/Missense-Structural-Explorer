import numpy as np
import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tools.model_server_app.utils import validate_missense_residues

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

router = APIRouter()

class StabilityOracleRequest(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    wtPdb: str | None = None

AA_LIST = ["A", "R", "N", "D", "C", "Q", "E", "G", "H", "I", "L", "K", "M", "F", "P", "S", "T", "W", "Y", "V"]
AA_TO_IDX = {aa: i for i, aa in enumerate(AA_LIST)}

if HAS_TORCH:
    class SpatialGraphTransformerLayer(nn.Module):
        """Spatial coordinate-aware multi-head graph attention layer."""
        def __init__(self, d_model=64, nhead=4, d_edge=16):
            super().__init__()
            self.d_model = d_model
            self.nhead = nhead
            self.d_head = d_model // nhead
            
            self.q_proj = nn.Linear(d_model, d_model)
            self.k_proj = nn.Linear(d_model, d_model)
            self.v_proj = nn.Linear(d_model, d_model)
            self.edge_proj = nn.Linear(d_edge, d_model)
            
            self.out_proj = nn.Linear(d_model, d_model)
            self.norm1 = nn.LayerNorm(d_model)
            self.norm2 = nn.LayerNorm(d_model)
            self.mlp = nn.Sequential(
                nn.Linear(d_model, d_model * 2),
                nn.SiLU(),
                nn.Linear(d_model * 2, d_model)
            )

        def forward(self, nodes, edge_rbf, neighbor_mask):
            N, D = nodes.shape
            K = edge_rbf.shape[1]
            
            residual = nodes
            q = self.q_proj(nodes).view(N, self.nhead, self.d_head)
            edge_feat = self.edge_proj(edge_rbf).view(N, K, self.nhead, self.d_head)
            
            attn_scores = (q.unsqueeze(1) * edge_feat).sum(dim=-1) / np.sqrt(self.d_head)
            attn_scores = attn_scores.masked_fill(~neighbor_mask.unsqueeze(-1), -1e9)
            attn_weights = F.softmax(attn_scores, dim=1)
            
            out = (attn_weights.unsqueeze(-1) * edge_feat).sum(dim=1).view(N, D)
            nodes = self.norm1(residual + self.out_proj(out))
            nodes = self.norm2(nodes + self.mlp(nodes))
            return nodes

    class StabilityOracleModel(nn.Module):
        """3D Graph Transformer network for thermodynamic protein stability prediction (ddG)."""
        def __init__(self, d_model=64, num_rbf=16):
            super().__init__()
            self.aa_embedding = nn.Embedding(len(AA_LIST) + 1, d_model)
            self.register_buffer("rbf_centers", torch.linspace(0.0, 16.0, num_rbf))
            self.rbf_gamma = 0.5
            
            self.layer1 = SpatialGraphTransformerLayer(d_model, nhead=4, d_edge=num_rbf)
            self.layer2 = SpatialGraphTransformerLayer(d_model, nhead=4, d_edge=num_rbf)
            
            self.ddg_head = nn.Sequential(
                nn.Linear(d_model * 2, 64),
                nn.SiLU(),
                nn.Linear(64, 32),
                nn.SiLU(),
                nn.Linear(32, 1)
            )

        def encode_rbf(self, dists):
            return torch.exp(-self.rbf_gamma * (dists.unsqueeze(-1) - self.rbf_centers) ** 2)

        def forward(self, wt_tokens, mut_token, target_idx, coords, k_neighbors=24):
            N = wt_tokens.shape[0]
            wt_emb = self.aa_embedding(wt_tokens)
            
            diff = coords.unsqueeze(1) - coords.unsqueeze(0)
            dists = torch.norm(diff, dim=-1)
            
            k = min(k_neighbors, max(1, N - 1))
            topk_dists, _ = torch.topk(dists, k=k+1, largest=False, dim=-1)
            topk_dists = topk_dists[:, 1:]
            neighbor_mask = topk_dists <= 16.0
            
            edge_rbf = self.encode_rbf(topk_dists)
            
            h = self.layer1(wt_emb, edge_rbf, neighbor_mask)
            h = self.layer2(h, edge_rbf, neighbor_mask)
            
            target_wt_feat = h[target_idx]
            mut_emb = self.aa_embedding(mut_token)
            
            pair_feat = torch.cat([target_wt_feat, mut_emb - wt_emb[target_idx]], dim=-1)
            raw_pred = self.ddg_head(pair_feat).squeeze()
            
            contacts = int((topk_dists[target_idx] <= 10.0).sum().item())
            return raw_pred, contacts

    _stability_oracle_model = None

    def get_stability_oracle_model() -> StabilityOracleModel:
        global _stability_oracle_model
        if _stability_oracle_model is None:
            model = StabilityOracleModel()
            model.eval()
            _stability_oracle_model = model
        return _stability_oracle_model

def predict_stabilityoracle_sync(req: StabilityOracleRequest):
    validate_missense_residues(req.wt, req.mut)
    raise HTTPException(
        status_code=501,
        detail="StabilityOracle pre-trained model checkpoint is not installed. In accordance with the project's strict No-Heuristics Policy, synthetic approximations are disabled. Please use validated predictors (FoldX, ThermoMPNN, RaSP, DynaMut2, DDMut)."
    )

@router.post("/predict/stabilityoracle")
async def predict_stabilityoracle(req: StabilityOracleRequest):
    return await asyncio.to_thread(predict_stabilityoracle_sync, req)
