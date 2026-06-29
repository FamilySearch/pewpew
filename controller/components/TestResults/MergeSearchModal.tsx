import { API_SEARCH_FORMAT, API_TEST_FORMAT } from "../../types";
import { LogLevel, log } from "../../src/log";
import { Modal, ModalObject } from "../Modal";
import React, { Ref, forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { TestData, TestManagerError } from "../../types/testmanager";
import axios, { AxiosResponse } from "axios";
import { Button } from "../LinkButton";
import { formatPageHref } from "../../src/clientutil";
import styled from "styled-components";

const SearchRow = styled.div`
  display: flex;
  gap: 0.5em;
  margin-bottom: 1em;
`;

const SearchInput = styled.input`
  flex: 1;
  padding: 0.4em 0.8em;
  background-color: #1a1a1a;
  color: white;
  border: 1px solid #444;
  border-radius: 4px;
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: #6a7bb4;
  }

  &::placeholder {
    color: #666;
  }
`;

const ResultsList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
`;

const ResultsItem = styled.li<{ $selectable: boolean }>`
  padding: 0.5em;
  border-bottom: 1px solid #444;
  cursor: ${({ $selectable }) => ($selectable ? "pointer" : "default")};
  opacity: ${({ $selectable }) => ($selectable ? 1 : 0.5)};

  &:hover {
    background-color: ${({ $selectable }) => ($selectable ? "#2a2a2a" : "transparent")};
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.6em;
    cursor: ${({ $selectable }) => ($selectable ? "pointer" : "default")};
    color: #ccc;
    font-size: 13px;

    input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: ${({ $selectable }) => ($selectable ? "pointer" : "default")};
      flex-shrink: 0;
    }
  }
`;

const SelectedCount = styled.p`
  margin: 1em 0 0 0;
  color: #aaa;
  font-size: 13px;
`;

const HintBlock = styled.p`
  margin: 0 0 1em 0;
  padding: 0.6em 0.8em 0.6em 1.2em;
  border-left: 3px solid #6a7bb4;
  background-color: #1e2030;
  border-radius: 0 4px 4px 0;
  color: #aaa;
  font-size: 13px;
`;

/** Fully-fetched TestData, or null if the test has no results file */
type FullTestData = TestData | null;

interface MergeSearchModalProps {
  defaultSearchText: string;
  currentTestId: string;
  onMerge: (selected: TestData[]) => Promise<void>;
}

export const MergeSearchModal = forwardRef<ModalObject, MergeSearchModalProps>(
  ({ defaultSearchText, currentTestId, onMerge }, ref: Ref<ModalObject>) => {
    const [searchText, setSearchText] = useState(defaultSearchText);
    const [searchResults, setSearchResults] = useState<TestData[] | undefined>(undefined);
    const [selectedTests, setSelectedTests] = useState<Map<string, TestData>>(new Map());
    const [isSearching, setIsSearching] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [searchError, setSearchError] = useState<string | undefined>(undefined);

    // Full TestData fetched per testId — undefined = not fetched, null = no results, TestData = has results
    const [fetchedTests, setFetchedTests] = useState<Map<string, FullTestData>>(new Map());
    // Ref to track in-flight fetches so we never double-fetch
    const pendingFetchIds = useRef<Set<string>>(new Set());

    // Fetch full TestData for each search result to learn resultsFileLocation.
    // The search API returns stub TestData (Unknown status, no resultsFileLocation).
    // Accumulated across searches so selections from earlier searches stay valid.
    useEffect(() => {
      if (!searchResults || searchResults.length === 0) { return; }

      for (const test of searchResults) {
        if (fetchedTests.has(test.testId) || pendingFetchIds.current.has(test.testId)) {
          continue; // already fetched or in-flight
        }
        pendingFetchIds.current.add(test.testId);

        axios.get(formatPageHref(API_TEST_FORMAT(test.testId)))
          .then((response: AxiosResponse) => {
            const result: TestData | TestManagerError = response.data;
            if ("message" in result || !result.resultsFileLocation?.length) {
              setFetchedTests((prev) => new Map(prev).set(test.testId, null));
            } else {
              setFetchedTests((prev) => new Map(prev).set(test.testId, result as TestData));
            }
          })
          .catch((error) => {
            log(`MergeSearchModal: failed to fetch full data for ${test.testId}`, LogLevel.WARN, error);
            setFetchedTests((prev) => new Map(prev).set(test.testId, null));
          })
          .finally(() => {
            pendingFetchIds.current.delete(test.testId);
          });
      }
    // We only want to fire this when the set of search result IDs changes.
    }, [searchResults]);

    // When full data arrives for a selected test, upgrade the stored TestData so
    // resultsFileLocation is available when the parent calls onMerge.
    useEffect(() => {
      setSelectedTests((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [testId] of prev) {
          const full = fetchedTests.get(testId);
          if (full === null) {
            // Confirmed no results — deselect it
            next.delete(testId);
            changed = true;
          } else if (full && full !== prev.get(testId)) {
            // Replace stub with full data
            next.set(testId, full);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, [fetchedTests]);

    const handleSearch = useCallback(async () => {
      const term = searchText.trim();
      if (!term) { return; }
      setIsSearching(true);
      setSearchError(undefined);
      // Evict fetchedTests entries that are not selected so the map doesn't grow unboundedly
      // across multiple searches. Selected entries are preserved so their data stays available.
      setFetchedTests((prev) => {
        const next = new Map<string, FullTestData>();
        for (const [testId, data] of prev) {
          if (selectedTests.has(testId)) { next.set(testId, data); }
        }
        return next.size === prev.size ? prev : next;
      });
      try {
        const response: AxiosResponse = await axios.get(formatPageHref(API_SEARCH_FORMAT(term)));
        if (Array.isArray(response.data)) {
          const results: TestData[] = response.data.filter((t: TestData) => t.testId !== currentTestId);
          setSearchResults(results);
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        log("MergeSearchModal search error", LogLevel.ERROR, error);
        setSearchError("Search failed. Please try again.");
        setSearchResults(undefined);
      } finally {
        setIsSearching(false);
      }
    }, [searchText, currentTestId, selectedTests]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { handleSearch(); }
    };

    const handleToggle = useCallback((testId: string) => {
      setSelectedTests((prev) => {
        const full = fetchedTests.get(testId);
        if (!full) { return prev; } // no results — do nothing

        const next = new Map(prev);
        if (next.has(testId)) {
          next.delete(testId);
        } else {
          next.set(testId, full); // always store full TestData with resultsFileLocation
        }
        return next;
      });
    }, [fetchedTests]);

    const handleMerge = useCallback(async () => {
      setIsMerging(true);
      try {
        await onMerge(Array.from(selectedTests.values()));
      } finally {
        setIsMerging(false);
      }
    }, [selectedTests, onMerge]);

    const mergeLabel = selectedTests.size > 0
      ? `Merge (+ ${selectedTests.size} more)`
      : "Merge";

    return (
      <Modal
        ref={ref}
        title="Merge Results"
        closeText="Cancel"
        onSubmit={handleMerge}
        submitText={mergeLabel}
        isReady={selectedTests.size > 0}
        scrollable
      >
        {isMerging ? (
          <p style={{ color: "#aaa", fontSize: "14px", margin: "1em 0" }}>
            Merging results, please wait…
          </p>
        ) : (
          <>
            <SearchRow>
              <SearchInput
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search by test name..."
              />
              <Button onClick={handleSearch} disabled={isSearching}>
                {isSearching ? "Searching…" : "Search"}
              </Button>
            </SearchRow>
            <HintBlock>Search by S3 Key Path, not TestId</HintBlock>

            {searchError && (
              <p style={{ color: "#e15759", marginBottom: "1em", fontSize: "13px" }}>
                {searchError}
              </p>
            )}

            {searchResults !== undefined && searchResults.length === 0 && (
              <p style={{ color: "#aaa", fontSize: "13px" }}>No tests found for "{searchText}"</p>
            )}

            {searchResults && searchResults.length > 0 && (
              <ResultsList>
                {searchResults.map((test) => {
                  const full = fetchedTests.get(test.testId);
                  const isFetching = !fetchedTests.has(test.testId);
                  const hasResults = !!full; // null = no results, TestData = has results

                  return (
                    <ResultsItem
                      key={test.testId}
                      $selectable={hasResults}
                      onClick={() => hasResults && handleToggle(test.testId)}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedTests.has(test.testId)}
                          onChange={() => hasResults && handleToggle(test.testId)}
                          disabled={!hasResults}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span>
                          {test.testId}
                          {isFetching && (
                            <span style={{ color: "#888" }}> — Checking…</span>
                          )}
                          {!isFetching && !hasResults && (
                            <span style={{ color: "#e15759" }}> (no results)</span>
                          )}
                          {!isFetching && hasResults && (
                            <span style={{ color: "#888" }}> — {full.status}</span>
                          )}
                        </span>
                      </label>
                    </ResultsItem>
                  );
                })}
              </ResultsList>
            )}

            {selectedTests.size > 0 && (
              <SelectedCount>
                {selectedTests.size} additional test{selectedTests.size === 1 ? "" : "s"} selected
              </SelectedCount>
            )}
          </>
        )}
      </Modal>
    );
  }
);

MergeSearchModal.displayName = "MergeSearchModal";
