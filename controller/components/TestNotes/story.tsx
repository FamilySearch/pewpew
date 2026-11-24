import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { TestNotes, TestNotesProps } from ".";
import { AuthPermission } from "../../types";
import { GlobalStyle } from "../Layout";
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";

const CollapsibleWrapper = (args: TestNotesProps) => {
  const [isExpanded, setIsExpanded] = useState(args.isExpanded ?? false);
  return <TestNotes {...args} isExpanded={isExpanded} onToggle={() => setIsExpanded((prev) => !prev)} />;
};

let ppaasTestId: PpaasTestId;
try {
  ppaasTestId = PpaasTestId.makeTestId("NotesStory");
} catch (error) {
  // PpaasTestId.makeTestId may fail in Storybook - use fallback
  console.warn("PpaasTestId.makeTestId failed in Storybook, using fallback", error); // eslint-disable-line no-console
  ppaasTestId = PpaasTestId.getFromS3Folder("NotesStory/" + PpaasTestId.getDateString());
}

const testData = { s3Folder: ppaasTestId.s3Folder };

const sampleNotes = `# Performance Test Notes: load-test.yaml

## Test Overview

| Field | Value |
|-------|-------|
| Test Name | load-test.yaml |
| Date | 2026-03-26T12:00:00.000Z |
| Status | Finished |
| Duration | 15m 32s |
| PewPew Version | 0.6.5 |

### Endpoints
- GET http://api.example.com/users (500hpm)
- POST http://api.example.com/search (200hpm)

### Load Patterns
- **linear** from 1% to 100% over 5m
- **linear** from 100% to 100% over 10m

## Objectives
Validate API response times under peak traffic after the caching layer migration.

## Environment
- **Target System**: api.example.com (production)
- **Dynatrace**: [Dashboard](https://dynatrace.example.com/dashboard)

## Findings
- p95 latency for /users dropped from 450ms to 120ms after cache warmup
- /search endpoint showed 2% error rate above 400hpm
- Memory usage on app-server-3 spiked to 85% during ramp

## Conclusion
- **Result**: Pass
- **Recommendations**:
  - Increase /search connection pool from 50 to 100
  - Add alerting threshold for memory > 80%
`;

const meta: Meta<TestNotesProps> = {
  title: "TestNotes",
  component: TestNotes,
  decorators: [(Story) => (
    <React.Fragment>
      <GlobalStyle />
      <Story />
    </React.Fragment>
  )]
};

export default meta;
type Story = StoryObj<TestNotesProps>;

// --- Empty notes (no pre-populated content) ---

/** ReadOnly: can view editor, no Save/Template/Delete buttons shown */
export const ReadOnlyEmpty: Story = {
  args: { testData, authPermission: AuthPermission.ReadOnly },
  name: "ReadOnly - Empty"
};

/** User: Save + Generate Template buttons shown, no Delete */
export const UserEmpty: Story = {
  args: { testData, authPermission: AuthPermission.User },
  name: "User - Empty"
};

/** Admin: Save + Generate Template + Delete buttons shown */
export const AdminEmpty: Story = {
  args: { testData, authPermission: AuthPermission.Admin },
  name: "Admin - Empty"
};

// --- Pre-populated notes ---

/** ReadOnly with notes: can view content, Export works, no Save/Template/Delete */
export const ReadOnlyWithNotes: Story = {
  args: { testData, authPermission: AuthPermission.ReadOnly, initialNotesContent: sampleNotes },
  name: "ReadOnly - With Notes"
};

/** User with notes: can view + edit + Save, Export + Confluence enabled, no Delete */
export const UserWithNotes: Story = {
  args: { testData, authPermission: AuthPermission.User, initialNotesContent: sampleNotes },
  name: "User - With Notes"
};

/** Admin with notes: full controls — Save, Generate Template, Export, Confluence, Delete */
export const AdminWithNotes: Story = {
  args: { testData, authPermission: AuthPermission.Admin, initialNotesContent: sampleNotes },
  name: "Admin - With Notes"
};

// --- Collapsible (interactive toggle, mirrors page behavior) ---

/** Starts collapsed; click Expand to reveal content. Loads notes in background. */
export const CollapsedWithNotes: Story = {
  args: { testData, authPermission: AuthPermission.User, initialNotesContent: sampleNotes, isExpanded: false },
  render: (args) => <CollapsibleWrapper {...args} />,
  name: "Collapsible - Starts Collapsed"
};

/** Starts expanded; click Collapse to hide content. */
export const ExpandedWithNotes: Story = {
  args: { testData, authPermission: AuthPermission.User, initialNotesContent: sampleNotes, isExpanded: true },
  render: (args) => <CollapsibleWrapper {...args} />,
  name: "Collapsible - Starts Expanded"
};
