"""Zero-shot forecasts from a pretrained time-series foundation model (Chronos-Bolt), for new products.

Optional: installed with `pip install .[foundation]` and enabled with AI_ENGINE_FOUNDATION_MODELS=1.
It pulls in PyTorch, which is why it is not part of the base image. When it is missing or fails,
`forecast` returns None and the caller falls back to the series' own short history.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

_PIPELINE = None
MODEL_ID = "amazon/chronos-bolt-small"


def _pipeline():
    global _PIPELINE
    if _PIPELINE is None:
        import torch
        from chronos import BaseChronosPipeline

        _PIPELINE = BaseChronosPipeline.from_pretrained(
            MODEL_ID, device_map="cuda" if torch.cuda.is_available() else "cpu", torch_dtype=torch.float32
        )
    return _PIPELINE


def forecast(train: pd.DataFrame, horizon: int) -> pd.DataFrame | None:
    try:
        import torch

        pipeline = _pipeline()
        ids, contexts = [], []
        for uid, group in train.groupby("unique_id"):
            ids.append(uid)
            contexts.append(torch.tensor(group.sort_values("ds")["y"].to_numpy(dtype=np.float32)))
        quantiles, _ = pipeline.predict_quantiles(contexts, prediction_length=horizon, quantile_levels=[0.1, 0.5, 0.9])
        last = train["ds"].max()
        future = pd.date_range(last + pd.Timedelta(days=1), periods=horizon, freq="D")
        frames = []
        for uid, q in zip(ids, quantiles.numpy()):
            frames.append(pd.DataFrame({"unique_id": uid, "ds": future, "p10": np.clip(q[:, 0], 0, None),
                                        "p50": np.clip(q[:, 1], 0, None), "p90": np.clip(q[:, 2], 0, None),
                                        "model": "ChronosBolt"}))
        return pd.concat(frames, ignore_index=True)
    except Exception:  # noqa: BLE001
        log.exception("foundation model unavailable; falling back to short-history forecasts")
        return None
