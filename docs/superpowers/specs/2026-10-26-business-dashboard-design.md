# Tổng quan vận hành kiếm tiền

Owner brief 26/10/2026: simple, fast, accurate. Consume existing GEN2 scans; never initiate another scan or change GEN2 repair/scheduling. $8–<10 = Sắp đủ; >=$10 = Đủ tiền rút. Deliberately OFF / Chưa cài are separate, excluded from active-health denominator. PayPal actual receipts is a later phase.

Top: three concise summaries (VM hoạt động, Tiền tăng hôm nay, Đủ tiền rút). Below: actionable issues, server comparison, upcoming proxy payments. Clicking a metric narrows an inline VM list; each VM opens its actual Server/VM detail. Stock/proxy charts and monthly finance remain available collapsed, rather than competing with operating priorities. Existing theme tokens/font; color only reinforces text (green healthy, red problem, amber missing/freshness, neutral paused). No new visual theme.

Data rules:
- Fresh GEN2 health must positively show EarnApp earning/running on the mapped VM; plain assigned proxy, stored OK, money or server online are insufficient. Existing reported problems remain visible; old/missing scans are unknown, never green. Reuse 24h freshness as existing money policy, display actual observation time separately from web refresh.
- Money stays current SDK + VM + cycle. Two valid observations today of that binding allow first-to-latest growth, labelled “Tăng ghi nhận hôm nay”, with coverage. One reading / stale / no timestamp / changed SDK or cycle = insufficient. A decrease is shown separately; a recorded withdrawal can explain it, but never count expected payout as income or treat decrease as stalled earnings. No fabricated midnight balance. Precision retained in computation, display at most 2 decimals with $.
- Thresholds describe amounts, not proof that EarnApp permits payment. Detail shows missing account / PP, stale check or existing payout. No automatic withdrawal.
- Proxy failures distinguish connection/auth/expiry/EarnApp Blocked; don't convert an Apple-check connectivity failure to global BLOCKED. Show affected server/VM and verification time. Renewals reuse stored due dates/rates, 3-day reminder policy; missing cost explicit.
- Server scope and money permissions apply before aggregation and DTO creation. No credentials or raw diagnostic/free-text secrets in overview.
- Telegram owner requested only new verified VM/EarnApp/proxy incidents, due reminders and confirmed recovery, durable dedup, no repeat while unchanged. Reuse existing destination after inspecting config; no arbitrary destination, no unverified recovery from absence of data.

GEN2 bridge must read existing results, preserve their timestamps and machine identities, skip ambiguous mappings/old cycles, and use normal web services/API rights/idempotency. It must not create jobs on real VMs or change machine/proxy/account settings. Exact available GEN2 fields are being verified; missing evidence remains unknown.

Acceptance: threshold edges 7.99/8/9.99/10, partial daily coverage, $0, withdrawn/decreased balance, SDK move/new cycle, stale/latest failed observation, intentional OFF/new VM, confirmed health vs status-only, restricted server/no-money user, direct detail count matches, refresh/error/empty/mobile/four themes. Synthetic test writes only; live read-only validation except explicit bridge observations if proven safe. No videos.
