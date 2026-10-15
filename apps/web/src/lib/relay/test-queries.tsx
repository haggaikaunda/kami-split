import { RelayEnvironmentProvider } from 'react-relay';
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
} from 'relay-runtime';
import { vi } from 'vitest';
import { financialDataID } from './environment';

/** Transport fixture for component tests: responses normalize through the real
 * store and hooks, while tests control delivery and cancellation independently. */
export function queryEnvironment(
  observe: (request: {
    name: string;
    variables: Record<string, unknown>;
    canceled: boolean;
    next(data: unknown): void;
    resolve(data: unknown): void;
    error(error?: Error): void;
    fail(): void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }) => void,
) {
  return new Environment({
    getDataID: financialDataID,
    network: Network.create((operation, variables) =>
      Observable.create((sink) => {
        const next = (data: unknown) => {
          sink.next({ data } as never);
          sink.complete();
        };
        const error = (failure = new Error('UNAVAILABLE')) =>
          sink.error(failure);
        const request = {
          name: operation.name,
          variables,
          next,
          resolve: next,
          error,
          fail: () => error(),
          canceled: false,
          unsubscribe: vi.fn(),
        };
        observe(request);
        return () => {
          request.canceled = true;
          request.unsubscribe();
        };
      }),
    ),
    store: new Store(new RecordSource()),
  });
}
/** Tests which start below FinancialSession must provide that session's store. */
export function relayRoot(
  root: Root,
  scope: () => { environment: Environment; id?: string } | undefined,
): Root {
  return {
    render(children: ReactNode) {
      const current = scope();
      root.render(
        current ? (
          <RelayEnvironmentProvider
            key={current.id}
            environment={current.environment}
          >
            {children}
          </RelayEnvironmentProvider>
        ) : (
          children
        ),
      );
    },
    unmount() {
      root.unmount();
    },
  };
}
