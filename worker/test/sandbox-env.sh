#!/usr/bin/env bash
# 沙盒脚本的公共环境。由 sandbox-*.sh 在 `cd "$HERE/.."`（即 worker/）之后 source。
#
# ── 口令绝不写死在脚本里 ──────────────────────────────────────────────
#
# 本仓库是**公开**的（GitHub Pages 用户站），而脚本里原来那行
# `KEY=<值>` 存的就是线上 Worker 的 HOUSE_KEY。2026-10-04 实测：
# https://raw.githubusercontent.com/MenglongFan/MenglongFan.github.io/main/worker/test/sandbox-donations.sh
# 能直接 200 下载到，任何人拿到它就能调 /api/prize-pool/withdraw 这类写接口
# —— 也就是说，任何看过这个仓库的人都能把奖池里的钱取走。
#
# 所以现在只从 worker/.dev.vars 读（该文件在 .gitignore 里，不会进仓库）。
#
# .dev.vars 里放**本地专用**的口令即可，不必等于线上那个 secret：
# 沙盒 worker 从它读 HOUSE_KEY，脚本把同一个值放进 X-House-Key，两边对上就行。
# 放一个和线上相同的值，只会让线上密钥多躺一份在磁盘上，没有好处。

KEY=$(sed -n 's/^HOUSE_KEY=//p' .dev.vars 2>/dev/null | head -1)
: "${KEY:?读不到 worker/.dev.vars 里的 HOUSE_KEY —— 该文件已 gitignore，格式见 worker/README.md}"
