# Dashboard Migration Summary

## Overview
Migrated the polished Splunk-style dashboard from `guide/results-viewer-react` to `controller` with visual improvements and custom HTML legends.

## Files Modified

### 1. `components/TestResults/charts.ts`
**Changes:**
- Updated color palette to Splunk-style theme
- Added `errorColors` palette for error visualizations
- Added 4 new chart functions for quad panel dashboard:
  - `medianDurationChart()` - P50 latency over time
  - `worst5PercentChart()` - P95 latency over time
  - `error5xxChart()` - 5xx error counts (stacked)
  - `allErrorsChart()` - All non-200 status codes (stacked)

**Configuration:**
- X-axis: 15-minute intervals, HH:mm format
- Y-axis: 6 tick limit, 12px fonts
- Tooltips: yAlign 'top', 13px fonts, improved padding/spacing
- Points: radius 0 (hidden), hover radius 6
- Legends: disabled (using custom HTML legends)

### 2. `components/TestResults/index.tsx`
**Changes:**
- Added styled components for quad grid layout (QUADGRID, QUADPANEL, CUSTOMLEGEND, LEGENDITEM, TOGGLECONTAINER)
- Added table styled components (TABLECONTAINER, DATATABLE, TH, DATATD, DATATR) with text wrapping
- Created `ChartPanel` component with custom HTML legend outside canvas
- Created `QuadPanelCharts` component with 2x2 grid of performance charts
- Created `FinalResultsTable` component with aggregated endpoint statistics
- Added merge endpoints toggle state management
- Integrated quad panel charts and Final Results table into main render

**New Components:**
```typescript
// Reusable chart panel with custom HTML legend
ChartPanel: { title, chartRef, chart, hiddenDatasets, onToggleDataset }

// Quad panel dashboard with 4 charts
QuadPanelCharts: { displayData, mergeEndpoints }

// Final results table
FinalResultsTable: { displayData }
```

### 3. `components/TestResultsCompare/index.tsx`
**Changes:**
- Complete rewrite to visual side-by-side format
- Removed delta-based comparison tables
- Added side-by-side quad panel charts (4 charts × 2 sides = 8 charts total)
- Added side-by-side Final Results tables
- Added merge endpoints toggle
- Reused chart functions from `charts.ts`

**Structure:**
- Empty state: "Select two results files to compare"
- Merge toggle: Groups endpoints by method+url when enabled
- Charts: Median, Worst 5%, 5xx Errors, All Errors (both sides)
- Tables: Final Results with 14 columns (both sides)

### 4. `test/quadpanelcharts.spec.tsx` (New)
**Coverage:**
- Legend functionality (render, toggle, styling)
- Merge endpoints toggle behavior
- Chart configuration (tooltips, spacing)
- Component structure

**Note:** Tests skip in jsdom environment due to WASM limitations. Use Storybook for visual testing.

### 5. `test/testresultscompare.spec.tsx` (New)
**Coverage:**
- Empty state handling
- Merge endpoints toggle
- Legend functionality
- Chart types (4 chart types)
- Table structure (14 columns)
- Data labels

**Note:** Tests skip in jsdom environment due to WASM limitations. Use Storybook for visual testing.

## Key Features

### Custom HTML Legends
- **Problem:** Chart.js canvas legends intercept clicks meant for dataset toggles
- **Solution:** Render legends as HTML outside the canvas
- **Benefits:** 
  - Proper click detection
  - Better styling control
  - Consistent with design system
  - Individual dataset toggle via click

### Merge Endpoints Toggle
- **Unchecked (default):** Shows all endpoints with full tag details `[tag1:value1 tag2:value2]`
- **Checked:** Groups endpoints by `method + url`, merging data points at same timestamps
- **Use case:** When tests have different tags (e.g., different hosts) but same endpoint

### Quad Panel Dashboard (2x2 Grid)
1. **Median Duration by Path** - P50 response times
2. **Worst 5% Duration by Path** - P95 response times  
3. **5xx Error Count by Path** - Server errors (stacked)
4. **All Errors** - All non-200 status codes (stacked)

### Final Results Table (14 columns)
Aggregates all data points for each endpoint:
- method, hostname, path, queryString, tags
- statusCount, callCount
- p50, p95, p99, min, max, stddev
- _time (last timestamp)

**Styling:** Text wrapping enabled for all cells (no ellipsis), compact font size (10-12px)

## Testing

### Storybook (Primary)
```bash
npm run storybook
# Navigate to http://localhost:5002
# Test stories: TestResults, TestResultsCompare
```

**Stories:**
- `DeepZoomResult` - Full dashboard with charts
- `LargeResult` - Performance test with large dataset
- `CompareDiscoveryRuns` - Side-by-side comparison
- `LargeResultComparison` - Compare large datasets

### Unit Tests
```bash
npm test
# Tests skip in jsdom (WASM doesn't load)
# TypeScript compilation: ✅ All tests compile
```

## Differences from Guide Version

### Intentional Omissions
- ✅ **No Excel export** - Controller doesn't need downloadable tables
- ✅ **Keep controller dropdown** - File selection from S3 results
- ✅ **Keep existing filters** - summaryTagFilter, summaryTagValueFilter
- ✅ **Keep comparison search** - Search for prior tests to compare

### Architecture Preserved
- ✅ S3 data loading via `fetchResults()`
- ✅ State management structure
- ✅ Existing Endpoint component for detailed views
- ✅ TestsListModal for comparison selection

## Visual Design

### Color Palette
- **Primary charts:** Splunk-style (Purple/Blue, Pink/Magenta, Orange/Gold, Teal/Cyan)
- **Error charts:** Orange/Pink theme (Coral Red, Hot Pink, Salmon, Tomato)
- **Background:** Dark theme (#2a2a2a panels, #1a1a1a headers)
- **Text:** White primary, #999 secondary
- **Borders:** #444

### Typography
- **Chart labels:** 12px fonts
- **Tooltips:** 13px body, bold title
- **Legends:** 11px
- **Tables:** 10-12px (compact in comparison view)

### Spacing
- **Grid gap:** 1.5em
- **Panel padding:** 1em
- **Legend gap:** 0.5em
- **Table cells:** 4-12px padding (varies by context)

## Browser Compatibility
- **Chart.js:** 4.5.0 with date adapter
- **Styled Components:** CSS-in-JS
- **WASM:** HDR histogram for statistical calculations
- **Target:** Modern browsers (ES2022, canvas support)

## Performance Considerations
- **Chart reuse:** useCallback with stable keys prevents unnecessary recreations
- **Data memoization:** useMemo for expensive transformations
- **Histogram cleanup:** Proper .free() calls to avoid WASM memory leaks
- **Canvas sizing:** Fixed height (270px) prevents layout thrashing

## Future Enhancements
1. **Enhanced Testing:** Headless Chrome tests with full WASM support
2. **Visual Regression:** Screenshot comparison in CI/CD
3. **Data Export:** Optional CSV/JSON export for specific use cases
4. **Chart Interactions:** Zoom, pan, cross-filtering
5. **Performance Metrics:** Additional percentiles (p90, p99.9)

## Deployment Checklist
- [x] Code migrated and tested in Storybook
- [x] Unit tests added (skip in jsdom, TypeScript validates)
- [x] TypeScript compilation verified
- [x] Git committed and pushed
- [ ] Deploy to test environment
- [ ] Run load test and verify dashboard
- [ ] Verify comparison view with two test results
- [ ] Check merge endpoints toggle behavior
- [ ] Verify legend click interactions

## Rollback Plan
If issues arise:
1. Revert commit: `git revert HEAD`
2. Restore from backup: `controller/components/TestResultsCompare/index.tsx.backup`
3. Redeploy previous version

## Documentation
- Storybook stories demonstrate all features
- Unit tests document expected behavior
- Inline code comments explain complex logic
- This file summarizes architectural decisions

---

**Migration Date:** 2026-04-03  
**Migrated By:** Claude Code  
**Guide Version:** results-viewer-react (polished dashboard)  
**Controller Version:** Updated with visual dashboard
