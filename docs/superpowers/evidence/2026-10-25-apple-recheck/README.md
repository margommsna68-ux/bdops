# Owner-requested Apple check retry — 25 October 2026

The owner clarified that the issue was unsuccessful technical checks needing another attempt, not a reported false Locked/Live classification. Existing confirmed results must remain untouched.

Initial read-only audit at16:27:38Z covered143 distinct accounts from the owner's current batches:88APPLE_LOCKED,20LIVE_2FA,15technical outcomes and20stillqueued/working. No observed health/result mismatch or contradictory definitive outcomes was found. Technical results were6UNKNOWN,3NETWORK_ERROR,5PROXY_ERROR,1CANCELLED.

Available private bounded metadata showed web API_TIMEOUT during job heartbeat before credential delivery on some older jobs, and failed proxied preflight requests on several others. Those observations identify the failing stage, not proof that an account is Locked/Live or that a VM's assigned proxy is globally Blocked. No proxy inventory state was changed.

Under the owner's explicit authorization,15 completed technical results were submitted for a new check through the existing requestCheckBatch service. Current account revisions and project rights were checked; stable per-account command keys were journaled before submission. The service enforced active-job deduplication and the existing15-minute credential-delivery cooldown. No cooldown was bypassed. Existing owner queue remained ahead of the new requests; runtime1.3.10 continued headless with at most5profiles and a fresh eligible random proxy/profile per attempt.

No completed Locked/Live result was retried. No code/schema/token/configuration/VM/AE/GEN2/Sheet/financial changes or browser takeover. No account password,2FA link,proxy credential,token or PIN was printed or put in evidence.

Final readback is stored in recheck-results.json. A technical failure remains unresolved until the worker observes the official Locked message or reaches the post-password2FA prompt (owner's Live convention); no invented binary outcome.

## Final verification — 16:32:44Z / 23:32 Bangkok

All15 rechecks completed:11APPLE_LOCKED and4LIVE_2FA, all cleanupOK. None remained technical/queued/active. Across the owner's143 distinct accounts, the latest results are100APPLE_LOCKED and43LIVE_2FA; no latest health/result mismatch and no unresolved technical result. Total158jobs retain the15earlier technical attempts as history.

Central native task remains Running, worker IDLE, zero owned Chrome/profile/pending/quarantine at16:32:39Z. No deployment/code change was required in this task; runtime remains1.3.10. These results do not establish completed Apple login beyond the2FA prompt or EarnApp registration, and are not a promise that future network checks never fail.
