/**
 * §14 · The outbox, and §11 · the realtime channels.
 *
 * Every state change writes its catalogued event, and the five §11 channels
 * are derived from those events rather than emitted separately — so a screen
 * subscribed to `approvals` and the audit drawer reading the outbox can never
 * disagree about what happened.
 */

import type {
  AnyActor,
  DomainEvent,
  DomainEventType,
  RealtimeChannel,
  RealtimeMessage,
} from "@trainos/contract";
import { TENANT_ID } from "../data/_helpers";

export type DomainEventHandler = (event: DomainEvent) => void;
export type RealtimeHandler = (message: RealtimeMessage) => void;
export type Unsubscribe = () => void;

/** Narrows the union to the one member with this `type`. */
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

let sequence = 0;
const nextEventId = (): string => `evt_${(++sequence).toString().padStart(6, "0")}`;

/** Resets the id counter, so a `resetStore()` produces the same ids again. */
export const resetEventSequence = (): void => {
  sequence = 0;
};

export class EventBus {
  /** The outbox: every event emitted since the last reset, in order. */
  readonly emitted: DomainEvent[] = [];

  #typed = new Map<string, Set<DomainEventHandler>>();
  #all = new Set<DomainEventHandler>();
  #channels = new Map<RealtimeChannel | string, Set<RealtimeHandler>>();

  /** Subscribe to one catalogued event type, e.g. `ApprovalRequested`. */
  on<T extends DomainEventType>(type: T, handler: (event: EventOf<T>) => void): Unsubscribe {
    const handlers = this.#typed.get(type) ?? new Set<DomainEventHandler>();
    const wrapped = handler as DomainEventHandler;
    handlers.add(wrapped);
    this.#typed.set(type, handlers);
    return () => handlers.delete(wrapped);
  }

  /** Subscribe to every event, for an audit drawer or a test. */
  onAny(handler: DomainEventHandler): Unsubscribe {
    this.#all.add(handler);
    return () => this.#all.delete(handler);
  }

  /**
   * §11 subscribe to realtime channels. `runs:{runId}` is parameterised, so
   * pass the full channel name for a single run.
   */
  subscribe(channels: readonly string[], handler: RealtimeHandler): Unsubscribe {
    for (const channel of channels) {
      const handlers = this.#channels.get(channel) ?? new Set<RealtimeHandler>();
      handlers.add(handler);
      this.#channels.set(channel, handlers);
    }
    return () => {
      for (const channel of channels) this.#channels.get(channel)?.delete(handler);
    };
  }

  /** Emit a catalogued event, filling the four envelope fields §14 requires. */
  emit<T extends DomainEventType>(
    type: T,
    payload: Extract<DomainEvent, { type: T }>["payload"],
    actor: AnyActor,
    occurredAt: string,
  ): DomainEvent {
    const event = {
      eventId: nextEventId(),
      occurredAt,
      tenantId: TENANT_ID,
      actor,
      type,
      payload,
    } as DomainEvent;
    this.emitted.push(event);
    for (const handler of this.#typed.get(type) ?? []) handler(event);
    for (const handler of this.#all) handler(event);
    return event;
  }

  /** §11 push one frame onto a channel. */
  publish(channel: string, data: RealtimeMessage["data"]): void {
    const message = { channel, data } as RealtimeMessage;
    for (const handler of this.#channels.get(channel) ?? []) handler(message);
  }

  /** Drops the outbox and every subscription — used by `resetStore()`. */
  clear(): void {
    this.emitted.length = 0;
    this.#typed.clear();
    this.#all.clear();
    this.#channels.clear();
  }
}
