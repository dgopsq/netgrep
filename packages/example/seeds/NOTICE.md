# Attribution

The four files in this directory (`apache.log`, `zookeeper.log`, `hadoop.log`,
`openssh.log`) are **truncated prefixes** — the first ~500 KB of whole lines —
of log files from **loghub-2.0**, not the datasets themselves. The full
datasets are not redistributed here; `packages/example/scripts/build-logs.mjs`
tiles these prefixes into the larger files the demo actually searches, and
those generated files are gitignored and never committed.

- **Source:** loghub-2.0, Zenodo record
  [8275861](https://zenodo.org/records/8275861).
- **Licence:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Files used:** `Apache/Apache_full.log`, `Zookeeper/Zookeeper_full.log`,
  `Hadoop/Hadoop_full.log`, `OpenSSH/OpenSSH_full.log`.

## Citation

> Jieming Zhu, Shilin He, Pinjia He, Jinyang Liu, Michael R. Lyu.
> "Loghub: A Large Collection of System Log Datasets for AI-driven Log Analytics." ISSRE 2023.
