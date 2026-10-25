# Apple check concurrent follow-up - 25 October 2026

Code b9ef461, web build w4zJ9FN77dc5Gs6nGIftU, deployed18:04Bangkok; worker1.2.0 Central (previous1.1.0). Additive migration20261025092000_apple_check_claim_slots adds claimSlot default1, old clients preserved.

Root cause1: official Apple page renders both inputs visible while #sign-in still Continue. Old code filled both then clicked once, only advancing email. Anonymous live control metadata + official public widget source verified this; new regression red->green, native synthetic Chromium confirms Continue once then password-submit once then LIVE_2FA. Rootcause2: Apple widget #errMsg/#alertInfo does not use role=alert; added exact observed source selectors, red->green invalid-credentials assertion. Loading controls never count as password phase.

Max5 concurrent independent slots, durable claim keys, exclusive randomly selected eligible NEW SELF proxy per active job, UUID profile isolation. Global startup recovery barrier for root+all5 journals; quarantine blocks admissions but permits all recovery peers. Replay preserves original slot even after terminalcleanup. Memory admission reserves per active slot; desktop loss drains. Windows EPERM sharing locks on journal replacement reproduced via native locked file and fixed by bounded atomic-rename retry, never deleting oldjournal.

Verification:1181/1181webtests(204files),75/75Nodeworker tests; types/lint/build pass (preexisting lint warnings). Native Central opened5blank Cloak sessions concurrently:5unique UUIDprofiles,5distinct fingerprint samples with defaultengine, all5cleaned. No physical-machine diversity claim. No anti-detect/global browser flags changed. Proxy picking was alreadyrandom; backend tests prove five simultaneous exclusive leases. No real account data in native proof. No video.

Profile deletion: every terminal outcome closes and verifies browserexit, deletes owned profile before resultreport. Only minimal pending-command journal may remain after networkloss. Unresolved cleanup quarantines and prevents new admission until safe cleanup recovery; unrelated profiles untouched.

Backup moneytohome-20261025-180337.dump plus encrypted/decryptionverified moon copy82f6fc8b1e2cfcfd509bf5492f974e45ba8ba71345c1a9d4e07903754a69a1ca. Rollback D:/MoneyToHome/app-before-apple-check-pool-20261025. Before/afterdeploy counts+fingerprint equal:678VM,149logins,1465proxy,4batches,4costs,0payout/funds, bc0e9b8e92afaa7f102c3f6581cae6a43695492babae5e0fb7f1f645b39284da. One real canary from owner's lastthree-selected account queued after15-minute cooldown, no new random account; see final result below.


## Further real verification and cleanup correction
Worker1.2.2 is installed. Total87/87Node tests including10ownership tests pass; only worker changed since the1181webtests. Review cleared bounded diagnostics and exact owned-process termination.

The first post-fix real check stillreturnedUNKNOWN/RESPONSE_UNRECOGNIZED. The second failed before secret delivery with residual ownedChrome; resultwas initiallyPROXY_ERROR (startup mislabel), cleanupFAILED. Operator verified its exact UUID/tree, stopped only ownedChrome and removed the profile; cleanup recovery markedOK. No unrelated browser or VM process stopped. This prompted verified native-process fallback and separate startup classification in1.2.2.

Final original third-account diagnostic job cmvnqhg140002of56zy27wkw9 remainsQUEUED with no secret delivered: workerWAITING_DESKTOP because interactive Windows session is locked/disconnected. Owner asked whether to retain visible browsers or enable noninteractive background operation. No further real accounts or repeated password attempts. Final measured owned browsers0/profiles0/pending0/quarantines0. Real login/Locked/2FA outcomes remain unverified; do not call the Apple checker fully accepted.
