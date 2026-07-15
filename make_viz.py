#!/usr/bin/env python3
# =============================================================================
# make_viz.py — render the kp/ bundle as an interactive HTML graph using the
# OKF reference visualizer (GoogleCloudPlatform/knowledge-catalog).
#
#   Setup (once):  git clone --depth 1 \
#       https://github.com/GoogleCloudPlatform/knowledge-catalog.git
#     (only pyyaml is needed for the viewer; the agent's LLM deps are NOT)
#
#   Usage:  python3 make_viz.py [kp_dir] [out_html] [repo_dir]
#           defaults: kp  kp_viz.html  ./knowledge-catalog
#
# What it adds over calling the CLI directly:
#   - stages a filtered copy (drops _templates/, README.md, bundle.yaml) so
#     only real concepts become nodes
#   - overrides the hardcoded BigQuery color palette with our concept kinds
# =============================================================================
import sys, os, shutil, tempfile

# Default: the FULL plane, measures included. --conceptual renders the reduced
# entity/attribute/relationship view (classic conceptual-model diagram).
WITH_MEASURES = '--conceptual' not in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith('--')]
KP   = args[0] if len(args) > 0 else 'kp'
OUT  = args[1] if len(args) > 1 else 'kp_viz.html'
REPO = args[2] if len(args) > 2 else 'knowledge-catalog'

sys.path.insert(0, os.path.join(REPO, 'okf', 'src'))
from reference_agent.viewer import generator as gen  # noqa: E402

# our kinds -> colors (entity anchors the graph, so it gets the strongest hue)
gen._TYPE_PALETTE = {
    'entity':        '#3b82f6',  # blue
    'defined_class': '#8b5cf6',  # violet
    'measure':       '#10b981',  # green
    'attribute':     '#f59e0b',  # amber
}

with tempfile.TemporaryDirectory() as tmp:
    stage = os.path.join(tmp, 'kp')
    shutil.copytree(KP, stage, ignore=shutil.ignore_patterns('_templates', 'agent', 'README.md', 'bundle.yaml', '.*'))
    if not WITH_MEASURES:
        for root, dirs, files in os.walk(stage):
            for fn in files:
                fp = os.path.join(root, fn)
                if fn.endswith('.md') and '\ntype: measure\n' in open(fp, encoding='utf-8').read():
                    os.remove(fp)
    from pathlib import Path
    stats = gen.generate_visualization(Path(stage), Path(OUT), bundle_name='Knowledge Plane')
    print('viewer stats:', stats)
print(f'-> {OUT}  (open in any browser)')
