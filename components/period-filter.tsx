"use client";

import {
  createPeriodState,
  describePeriod,
  periodLabels,
  type PeriodPreset,
  type PeriodState
} from "@/lib/period";

type PeriodFilterProps = {
  value: PeriodState;
  onChange: (value: PeriodState) => void;
};

const presets: PeriodPreset[] = ["today", "week", "month", "year", "custom"];

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  function changePreset(preset: PeriodPreset) {
    if (preset === "custom") {
      onChange({ ...value, preset });
      return;
    }

    onChange(createPeriodState(preset));
  }

  return (
    <section className="mb-6 card p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-[220px_1fr_1fr]">
          <div>
            <label className="field-label" htmlFor="periodPreset">
              Период
            </label>
            <select
              id="periodPreset"
              className="field mt-1"
              value={value.preset}
              onChange={(event) => changePreset(event.target.value as PeriodPreset)}
            >
              {presets.map((preset) => (
                <option key={preset} value={preset}>
                  {periodLabels[preset]}
                </option>
              ))}
            </select>
          </div>

          {value.preset === "custom" ? (
            <>
              <div>
                <label className="field-label" htmlFor="periodStart">
                  Дата начала
                </label>
                <input
                  id="periodStart"
                  className="field mt-1"
                  type="date"
                  value={value.startDate}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      startDate: event.target.value
                    })
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="periodEnd">
                  Дата конца
                </label>
                <input
                  id="periodEnd"
                  className="field mt-1"
                  type="date"
                  value={value.endDate}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      endDate: event.target.value
                    })
                  }
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="rounded-md border border-line bg-soft/40 px-3 py-2 text-sm text-muted">
          {describePeriod(value)}
        </div>
      </div>
    </section>
  );
}
