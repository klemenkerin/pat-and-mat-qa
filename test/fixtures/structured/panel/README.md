Panel / time-series fixtures for the coverage checks.

- `A-9-rows.csv`: attempt 1 of live Task `01a18ea9-a005-707c-9e22-1ea7f4b3afa3` (Advanced Web Research, 2026-10-30), 9 rows instead of 60.
- `B-60-rows-weekend-padded.csv`: attempt 2 of the same Task, which Pat accepted before the coverage checks existed: exactly 60 rows, but FTSE100 rows on weekends (2026-10-11, 10-17, 10-18, 10-24, 10-25) with forward-filled closes, and DAX/CAC40 missing on several dates.
- `C-60-rows-correct.csv`: generated (not market data): 20 weekdays ending 2026-10-30 × DAX, CAC40, FTSE100, no repeated values.
