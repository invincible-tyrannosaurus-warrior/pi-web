"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { measureColumnWidths, parseDelimitedTable, visibleRowRange } from "@/lib/delimited-table";

// Rows are virtualized, so they share one fixed height (one line of 13px text).
const ROW_HEIGHT = 26;
const OVERSCAN_ROWS = 20;

/**
 * A `.csv` / `.tsv` file as a table in the file viewer's Preview. It looks like
 * the markdown tables (`.file-table` in app/globals.css): the first record is
 * the header, and the gutter shows the file line each record starts on, like
 * the source view's line numbers. Only rows around the viewport are rendered,
 * between two spacer rows that keep the full scroll height. The viewer's
 * content box scrolls (`scrollRef`), so its position is saved like the source
 * view's. `complete: false` means `content` is a loaded prefix of the file.
 */
export function DelimitedTable({
  content,
  filePath,
  complete,
  scrollRef,
}: {
  content: string;
  filePath: string;
  complete: boolean;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  // ponytail: re-parses the whole loaded text on each chunk or live update; parse incrementally if big files lag.
  const table = useMemo(() => parseDelimitedTable(content, filePath, complete), [complete, content, filePath]);
  const widths = useMemo(() => measureColumnWidths(table.columns, table.rows), [table]);
  const lastLine = table.rowLines[table.rowLines.length - 1] ?? table.headerLine;
  // Widths are in em of the table font, so they follow the chat font size; the 11px gutter
  // digits are about 0.45em of it, and four of them fit the minimum (the source view's 48px).
  const gutterWidth = Math.max(3.7, String(lastLine).length * 0.45 + 1.5);
  const totalWidth = widths.reduce((sum, width) => sum + width, gutterWidth);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  // A passive effect: the scroll box's ref is attached only after this
  // component's layout effects have run.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
      setViewportWidth(element.clientWidth);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    sync();
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scrollRef]);

  if (table.columns.length === 0) return null;

  // The header row sits above the first body row, so the body starts one row lower.
  const { start, end } = visibleRowRange(table.rows.length, ROW_HEIGHT, scrollTop - ROW_HEIGHT, viewportHeight, OVERSCAN_ROWS);
  const body = [];
  for (let index = start; index < end; index += 1) {
    const row = table.rows[index];
    body.push(
      <tr key={index} className={index % 2 === 1 ? "file-table-row is-striped" : "file-table-row"}>
        <td className="file-table-gutter">{table.rowLines[index]}</td>
        {widths.map((_, column) => {
          const value = row[column] ?? "";
          return <td key={column} title={value || undefined}>{value}</td>;
        })}
      </tr>,
    );
  }
  const spacer = (height: number) => (
    <tr aria-hidden="true" className="file-table-spacer" style={{ height }}>
      <td colSpan={widths.length + 1} />
    </tr>
  );

  return (
    <div className="file-table-wrap">
      {/* Fixed layout: the column widths are measured here, so they hold while rows scroll in and out.
          At least the panel's width (less the wrap's 8px margins and border): a percentage would
          resolve against the max-content wrap and never settle. */}
      <table className="file-table" style={{ width: `max(${totalWidth}em, ${Math.max(0, viewportWidth - 18)}px)`, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: `${gutterWidth}em` }} />
          {/* The last column takes what is left, so a wide panel never stretches the gutter. */}
          {widths.map((width, index) => <col key={index} style={index === widths.length - 1 ? undefined : { width: `${width}em` }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="file-table-gutter" scope="col">{table.headerLine}</th>
            {table.columns.map((column, index) => (
              <th key={index} scope="col" title={column || undefined}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {start > 0 && spacer(start * ROW_HEIGHT)}
          {body}
          {end < table.rows.length && spacer((table.rows.length - end) * ROW_HEIGHT)}
        </tbody>
      </table>
    </div>
  );
}
