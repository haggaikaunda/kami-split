'use client';
import { Component, createRef, type ReactNode } from 'react';

type Props = { busy: boolean; children: ReactNode; className?: string };

/** Snapshot only geometry before React replaces private content. The pre-mutation
 * lifecycle also captures a resize that has not yet delivered an observer event. */
export class WorkspaceLoading extends Component<Props> {
  private element = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: Props): number | null {
    return !previous.busy && this.props.busy
      ? (this.element.current?.getBoundingClientRect().height ?? null)
      : null;
  }

  componentDidUpdate(_previous: Props, _state: unknown, height: number | null) {
    const node = this.element.current;
    if (!node) return;
    if (!this.props.busy) node.style.minHeight = '';
    else if (height !== null) node.style.minHeight = `${height}px`;
  }

  render() {
    return (
      <div
        ref={this.element}
        data-ui="workspace-loading-surface"
        className={this.props.className}
      >
        {this.props.children}
      </div>
    );
  }
}
