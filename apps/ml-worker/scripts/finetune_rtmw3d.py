#!/usr/bin/env python3
"""Fine-tune RTMW3D on Stride's own footage — WRITTEN, NOT RUN.

This script is a design draft, not a tested tool. It has not been executed in
this environment and should not be, without first resolving the licensing
question below and actually having the three things it depends on (a
pretrained checkpoint, its matching MMPose config, and a labeled 3D dataset)
-- none of which are present in this repo.

=====================================================================
READ THIS BEFORE RUNNING ANYTHING
=====================================================================

1. LICENSING — the real blocker, not a formality.
   src/pose3d_rtmw.py's own docstring flags that RTMW3D's published weights
   carry unresolved training-data provenance: the model card says Apache-2.0,
   but the 3D training mix is believed to include H3WB, derived from
   Human3.6M, which is an ACADEMIC/NON-COMMERCIAL dataset. That restriction
   travels with the weights, not the code -- which is exactly why
   `.models/` is gitignored and the weights were never committed here.

   Fine-tuning does not launder that restriction away. A checkpoint fine-tuned
   FROM a restricted pretrained model is a derivative work of it. If the base
   weights can't be used commercially, a model fine-tuned from them can't
   either, until someone actually clears the provenance (contacting the
   RTMW3D/MMPose authors, or retraining the 3D head from a clean base). Do not
   point this script at a real checkpoint and ship the output before that is
   resolved -- that decision belongs to you and your partner, not to me.

2. WHAT'S ACTUALLY MISSING, of the three required inputs:
   a. Pretrained checkpoint (rtmw3d-x.onnx / its .pth) -- not in this repo.
      Fine-tuning also needs the ORIGINAL PYTORCH CHECKPOINT (.pth), not the
      ONNX export the app runs -- ONNX is inference-only, it can't be trained.
      You'd start from the MMPose model zoo checkpoint the ONNX was exported
      from.
   b. Its MMPose config .py -- also not in this repo; the `_base_` import
      below is a placeholder using the model zoo's typical naming pattern for
      an RTMW3D config, not a verified filename. Swap it for whatever config
      actually shipped next to your checkpoint.
   c. A labeled 3D dataset of Stride's own athletes -- does not exist yet.
      Unlike 2D pose data (labelable by a human clicking joints), 3D
      ground-truth needs either motion-capture or multi-view triangulation to
      produce real (x, y, z). Phone footage alone cannot supply the labels
      this script trains against. This is the actual project-sized piece of
      work, not the training loop itself.

3. TOOLCHAIN — this is a different stack from the app's runtime.
   The ml-worker runs inference via `rtmlib` + `onnxruntime` (see
   requirements.txt) precisely so it never needs PyTorch or a GPU in
   production. Fine-tuning needs the OpenMMLab training stack instead:
   torch, mmengine, mmcv, mmdet, mmpose. That's a training-time-only
   dependency set — do not add it to requirements.txt; keep it in a separate
   venv/requirements-train.txt if this is ever actually run.

=====================================================================
WHAT THIS SCRIPT DOES, ASSUMING ALL OF THE ABOVE IS RESOLVED
=====================================================================

Standard OpenMMLab fine-tuning recipe: take the base model's config, point
`load_from` at the pretrained checkpoint, swap in your own dataset, drop the
learning rate, optionally freeze the early backbone stages (the low-level
image features transfer fine; only the pose head usually needs to adapt to
new athletes/camera setups), and run MMEngine's `Runner`.

Usage (once the three inputs above exist):
    python3 finetune_rtmw3d.py \\
        --checkpoint /path/to/rtmw3d-x_pretrained.pth \\
        --train-ann /path/to/stride_train_3d.json \\
        --train-img-root /path/to/stride/frames \\
        --val-ann /path/to/stride_val_3d.json \\
        --val-img-root /path/to/stride/frames \\
        --work-dir ./work_dirs/rtmw3d-stride-finetune \\
        --freeze-backbone \\
        --epochs 20 \\
        --lr 5e-5
"""
from __future__ import annotations

import argparse
import sys


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--checkpoint", required=True,
                   help="Pretrained RTMW3D .pth checkpoint (NOT the .onnx export used at inference time).")
    p.add_argument("--base-config", default="rtmw3d-x_8xb64-270e_cocktail14-256x192.py",
                   help="MMPose config the checkpoint was trained with. PLACEHOLDER NAME — "
                        "replace with the config that actually ships next to your checkpoint.")
    p.add_argument("--train-ann", required=True,
                   help="COCO-WholeBody-3D-style annotation JSON for Stride's labeled training clips.")
    p.add_argument("--train-img-root", required=True)
    p.add_argument("--val-ann", required=True)
    p.add_argument("--val-img-root", required=True)
    p.add_argument("--work-dir", default="./work_dirs/rtmw3d-stride-finetune")
    p.add_argument("--epochs", type=int, default=20,
                   help="Fine-tuning runs, so this should be a small fraction of the ~270 epochs "
                        "the base model trained for.")
    p.add_argument("--lr", type=float, default=5e-5,
                   help="An order of magnitude (or more) below the base model's training LR — "
                        "fine-tuning adapts, it doesn't retrain from scratch.")
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--freeze-backbone", action="store_true",
                   help="Freeze the image backbone and only train the pose head/neck. Recommended "
                        "starting point given a small dataset — full unfreezing risks catastrophic "
                        "forgetting of the base model's general pose prior on a few hundred clips.")
    p.add_argument("--val-interval", type=int, default=1)
    p.add_argument("--dry-run", action="store_true",
                   help="Build and print the config without launching training. Always run this "
                        "first to sanity-check paths before spending GPU time.")
    return p.parse_args()


def build_config(args: argparse.Namespace) -> dict:
    """Assemble an MMEngine config dict by overriding the base RTMW3D config.

    Kept as a plain dict (rather than a written-out .py config file) so every
    override is visible in one place instead of scattered across an inherited
    config chain. `Config.fromfile` + `.merge_from_dict` is the standard
    OpenMMLab way to do this without hand-editing the base config.
    """
    from mmengine.config import Config

    cfg = Config.fromfile(args.base_config)

    # Load the pretrained weights, but do NOT resume its optimizer/scheduler
    # state — this is a fresh fine-tune run, not a continuation of the
    # original training run.
    cfg.load_from = args.checkpoint
    cfg.resume = False

    # --- dataset: point at Stride's own labeled clips -----------------------
    cfg.train_dataloader.batch_size = args.batch_size
    cfg.train_dataloader.dataset.ann_file = args.train_ann
    cfg.train_dataloader.dataset.data_prefix = dict(img=args.train_img_root)
    # Drop any dataset-specific subsampling/repeat the base config applied —
    # a small fine-tuning set shouldn't be further thinned.
    if "indices" in cfg.train_dataloader.dataset:
        cfg.train_dataloader.dataset.pop("indices")

    cfg.val_dataloader.dataset.ann_file = args.val_ann
    cfg.val_dataloader.dataset.data_prefix = dict(img=args.val_img_root)
    cfg.test_dataloader = cfg.val_dataloader

    # --- schedule: short, low-LR fine-tune, not a from-scratch run ---------
    cfg.train_cfg.max_epochs = args.epochs
    cfg.train_cfg.val_interval = args.val_interval
    cfg.optim_wrapper.optimizer.lr = args.lr
    # A short linear warmup then cosine decay to ~0 — avoids the large-LR
    # early-training instability that's fine for training from scratch but can
    # wreck already-good pretrained features.
    cfg.param_scheduler = [
        dict(type="LinearLR", start_factor=0.1, by_epoch=False, begin=0, end=200),
        dict(type="CosineAnnealingLR", by_epoch=True, begin=0, end=args.epochs,
             T_max=args.epochs, eta_min=args.lr * 0.01),
    ]

    # --- freezing: keep low-level features, adapt the head ------------------
    if args.freeze_backbone:
        cfg.model.backbone.frozen_stages = getattr(cfg.model.backbone, "frozen_stages", -1)
        # -1 means "none frozen" in most MMPose backbones; a positive value
        # freezes that many stages from the input side. The right number
        # depends on the specific backbone in your base config (check its
        # `num_stages`) — start with all-but-the-last-stage frozen and loosen
        # if validation loss plateaus too early.
        cfg.model.backbone.frozen_stages = max(
            0, getattr(cfg.model.backbone, "num_stages", 4) - 1)
        cfg.model.backbone.norm_eval = True  # freeze BatchNorm running stats too

    cfg.work_dir = args.work_dir
    cfg.default_hooks.checkpoint = dict(
        type="CheckpointHook", interval=1, save_best="AUC", rule="greater")

    return cfg


def main() -> None:
    args = parse_args()

    try:
        from mmengine.config import Config  # noqa: F401
        from mmengine.runner import Runner
    except ImportError:
        print(
            "mmengine/mmpose are not installed in this environment (by design — "
            "the ml-worker runtime only needs onnxruntime/rtmlib for inference). "
            "Fine-tuning needs its own venv: torch, mmengine, mmcv, mmdet, mmpose.",
            file=sys.stderr,
        )
        sys.exit(1)

    cfg = build_config(args)

    if args.dry_run:
        print(cfg.pretty_text)
        return

    runner = Runner.from_cfg(cfg)
    runner.train()


if __name__ == "__main__":
    main()
