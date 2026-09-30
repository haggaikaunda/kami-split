# Integration scenario coverage map

Issue #116 preserves the original assertions while giving every scenario its own fixture. No test uses `t.Parallel`; `scripts/db-test.sh` retains `-p=1` because database permission probes mutate cluster-global login roles.

Identity fixtures are removed after each test. Expense fixtures use unique IDs and transaction-local administrator cleanup. `TestPersistedExpenseFinancialBackupFixture` explicitly transfers one committed ledger to the disposable database runner so its final dump/replay still exercises financial history. The runner destroys that stack on success or failure.

The independent expense harness remains separate from the primary GraphQL harness. Only row cleanup is shared. Each test seeds its own prerequisite records; no scenario depends on another test running first.

## TestIdentityIndependent

| Original subtest                                 | Independent test                                          |
| ------------------------------------------------ | --------------------------------------------------------- |
| constraints                                      | `TestIdentityConstraints`                                 |
| projections and real role denial                 | `TestIdentityProjectionsAndRealRoleDenial`                |
| ACL ownership and hostile search path            | `TestIdentityAclOwnershipAndHostileSearchPath`            |
| context commit rollback cancel                   | `TestIdentityContextCommitRollbackCancel`                 |
| readmission same identity ordinary role          | `TestIdentityReadmissionSameIdentityOrdinaryRole`         |
| membership revocation wait fresh snapshot        | `TestIdentityMembershipRevocationWaitFreshSnapshot`       |
| read locks block revocation                      | `TestIdentityReadLocksBlockRevocation`                    |
| owner transfer and target inactivation serialize | `TestIdentityOwnerTransferAndTargetInactivationSerialize` |
| disable commits before waiting authorization     | `TestIdentityDisableCommitsBeforeWaitingAuthorization`    |
| managed Auth deletion no relink                  | `TestIdentityManagedAuthDeletionNoRelink`                 |

## TestPersistedExpenseJourney

| Original subtest                                                      | Independent test                                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| concurrent retries and mismatch                                       | `TestPersistedExpenseConcurrentRetriesAndMismatch`                                  |
| rejection is durable and changed key intent conflicts                 | `TestPersistedExpenseRejectionIsDurableAndChangedKeyIntentConflicts`                |
| authorization denies unrelated and absent identity                    | `TestPersistedExpenseAuthorizationDeniesUnrelatedAndAbsentIdentity`                 |
| read complete balances independent of one-page limit                  | `TestPersistedExpenseReadCompleteBalancesIndependentOfOnePageLimit`                 |
| recovery survives pool restart and inactive historical payer          | `TestPersistedExpenseRecoverySurvivesPoolRestartAndInactiveHistoricalPayer`         |
| runtime constraints reject partial effects and later zero allocations | `TestPersistedExpenseRuntimeConstraintsRejectPartialEffectsAndLaterZeroAllocations` |
| GraphQL projection nodes and signed pagination                        | `TestPersistedExpenseGraphqlProjectionNodesAndSignedPagination`                     |
| audit failure rolls back and same key safely retries                  | `TestPersistedExpenseAuditFailureRollsBackAndSameKeySafelyRetries`                  |
| complete same-group chain and all-zero cycle                          | `TestPersistedExpenseCompleteSameGroupChainAndAllZeroCycle`                         |
| lost commit response recovers through new pool and service            | `TestPersistedExpenseLostCommitResponseRecoversThroughNewPoolAndService`            |
| database COMMIT acknowledgement loss remains recoverable              | `TestPersistedExpenseDatabaseCommitAcknowledgementLossRemainsRecoverable`           |
| disabled actor cannot recover receipt                                 | `TestPersistedExpenseDisabledActorCannotRecoverReceipt`                             |

## TestIndependentFinancialRecoveryAndPagination

| Original subtest                                                                  | Independent test                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| simultaneous first attempts have one atomic effect                                | `TestIndependentExpenseSimultaneousFirstAttemptsHaveOneAtomicEffect`                           |
| later transaction cannot add same-group zero allocation                           | `TestIndependentExpenseLaterTransactionCannotAddSameGroupZeroAllocation`                       |
| zero-share participant matches filter                                             | `TestIndependentExpenseZeroShareParticipantMatchesFilter`                                      |
| anchor excludes later backdated write while balances refresh                      | `TestIndependentExpenseAnchorExcludesLaterBackdatedWriteWhileBalancesRefresh`                  |
| new pool service and endpoint recover original historical revision beyond 90 days | `TestIndependentExpenseNewPoolServiceAndEndpointRecoverOriginalHistoricalRevisionBeyond90Days` |
| canceled group-lock wait ends and same-key retry is safe                          | `TestIndependentExpenseCanceledGroupLockWaitEndsAndSameKeyRetryIsSafe`                         |
| revision exhaustion is durable and has no financial effect                        | `TestIndependentExpenseRevisionExhaustionIsDurableAndHasNoFinancialEffect`                     |

The primary fixture continues to assert creator/payer attribution and the exact 334/333/333 equal split on its first write. The balances, inactive-history, and GraphQL tests explicitly create their second expense. Independent revision exhaustion explicitly seeds four writes, and restart recovery creates a later revision before verifying the immutable original receipt. Fault-trigger removal is registered before the injected failure can abort its scenario; transaction rollbacks and fixture cleanup remain registered on failure paths.
