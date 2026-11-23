import {
  API_NOTES_SEARCH,
  AuthPermission,
  AuthPermissions,
  NotesSearchResult,
  PAGE_NOTES,
  PAGE_NOTES_FORMAT,
  PAGE_TEST_STATUS_FORMAT
} from "../types";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { H1, H3 } from "../components/Headers";
import { LogLevel, log } from "../src/log";
import React, { useState } from "react";
import axios, { AxiosResponse } from "axios";
import { formatError, formatPageHref } from "../src/clientutil";
import { Danger } from "../components/Alert";
import Div from "../components/Div";
import Layout from "../components/Layout";
import { TestNotes } from "../components/TestNotes";
import { authPage } from "../src/authserver";
import styled from "styled-components";
import { useRouter } from "next/router";

const Column = styled(Div)`
  flex-flow: column;
  flex: 1;
  text-align: center;
  justify-content: flex-start;
`;

const SearchForm = styled.form`
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  margin: 16px 0;
`;

const NotesList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 800px;
  margin: 16px auto;
  text-align: left;
`;

const NoteCard = styled.a`
  display: block;
  padding: 12px 16px;
  background: rgb(40, 40, 40);
  border: 1px solid rgb(67, 67, 67);
  border-radius: 6px;
  color: rgb(200, 200, 200);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: rgb(50, 50, 50);
  }
`;

const NoteCardTitle = styled.div`
  font-weight: 600;
  color: rgb(232, 230, 227);
  margin-bottom: 4px;
`;

const NoteCardMeta = styled.div`
  font-size: 0.8em;
  color: rgb(140, 140, 140);
`;

const ManualEntry = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  margin: 16px 0;
  flex-wrap: wrap;
`;

export interface NotesPageProps {
  authPermission?: AuthPermission;
  s3Folder?: string;
  error?: string;
}

const NotesPage = ({ authPermission, s3Folder: initialS3Folder, error: propsError }: NotesPageProps) => {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NotesSearchResult[] | null>(null);
  const [manualYamlFile, setManualYamlFile] = useState("");
  const [manualDateString, setManualDateString] = useState("");
  const [error, setError] = useState<string | undefined>(propsError);
  const [loading, setLoading] = useState(false);

  // Get s3Folder from query param (client-side routing)
  const s3Folder = (router.query.s3Folder as string) || initialS3Folder;

  // Otherwise show the notes browser/search
  const handleSearch = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    setSearchResults(null);
    try {
      const url = formatPageHref(API_NOTES_SEARCH) + `?q=${encodeURIComponent(searchQuery)}`;
      const response: AxiosResponse = await axios.get(url);
      setSearchResults(response.data);
      if (response.data.length === 0) {
        setError(`No notes found matching "${searchQuery}"`);
      }
    } catch (err) {
      log("Error searching notes", LogLevel.ERROR, err);
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleManualOpen = () => {
    // S3 folders use the test id name (lowercase, no extension, a-z0-9 only), not the YAML file name
    const testName = manualYamlFile.trim().toLowerCase().replace(/\.ya?ml$/, "").replaceAll(/[^a-z0-9]/g, "");
    const dateString = manualDateString.trim();
    if (testName && dateString) {
      const url = PAGE_NOTES_FORMAT(`${testName}/${dateString}`);
      router.push(url, formatPageHref(url)).catch((pushError: unknown) => log("router.push error", LogLevel.ERROR, pushError));
    }
  };

  // No auto-search on mount — user must click Search or submit the form

  // If we have an s3Folder, show the notes editor for that test
  if (s3Folder) {
    const parts = s3Folder.split("/");
    if (parts.length < 2) {
      return (
        <Layout authPermission={authPermission}>
          <Column><H1>Invalid s3Folder format</H1></Column>
        </Layout>
      );
    }
    const dateString = parts.pop() as string;
    const yamlFile = parts.join("/");
    const testData = { s3Folder };

    return (
      <Layout authPermission={authPermission}>
        <Column>
          <H1>Test Notes</H1>
          <div data-testid="notes-meta" style={{ fontSize: "0.8em", color: "rgb(140, 140, 140)", marginBottom: "8px" }}>
            <span data-testid="notes-yaml-file">{yamlFile}</span> / <span data-testid="notes-date-string">{dateString}</span>
            {" | "}
            <a data-testid="notes-view-test-link" href={formatPageHref(PAGE_TEST_STATUS_FORMAT(`${yamlFile}${dateString}`))}>View Test</a>
            {" | "}
            <a data-testid="notes-back-link" href={formatPageHref(PAGE_NOTES)} style={{ cursor: "pointer" }}>Back to Notes</a>
          </div>
          <TestNotes testData={testData} authPermission={authPermission} />
        </Column>
      </Layout>
    );
  }

  return (
    <Layout authPermission={authPermission}>
      <Column>
        <H1>Performance Test Notes</H1>

        <SearchForm onSubmit={handleSearch}>
          <label htmlFor="notes-search-input">Search Notes: </label>
          <input
            id="notes-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter test name prefix..."
            style={{ minWidth: "300px" }}
          />
          <button type="submit" data-testid="notes-search-button" disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </SearchForm>

        <H3>Open Notes by Test</H3>
        <ManualEntry>
          <label htmlFor="notes-yaml-file-input">Test Name:</label>
          <input
            id="notes-yaml-file-input"
            type="text"
            value={manualYamlFile}
            onChange={(e) => setManualYamlFile(e.target.value)}
            placeholder="e.g. mytest (from the test ID)"
          />
          <label htmlFor="notes-date-string-input">Date String:</label>
          <input
            id="notes-date-string-input"
            type="text"
            value={manualDateString}
            onChange={(e) => setManualDateString(e.target.value)}
            placeholder="e.g. 20260324T120000000"
          />
          <button data-testid="notes-open-button" onClick={handleManualOpen} disabled={!manualYamlFile || !manualDateString}>
            Open Notes
          </button>
        </ManualEntry>

        {error && <Danger>Error: {error}</Danger>}

        {searchResults && searchResults.length > 0 && (
          <>
            <H3>Notes ({searchResults.length})</H3>
            <NotesList>
              {searchResults.map((result) => (
                <NoteCard
                  key={result.s3Folder}
                  href={formatPageHref(PAGE_NOTES_FORMAT(result.s3Folder))}
                >
                  <NoteCardTitle>{result.yamlFile}</NoteCardTitle>
                  <NoteCardMeta>{result.dateString}</NoteCardMeta>
                </NoteCard>
              ))}
            </NotesList>
          </>
        )}
      </Column>
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<NotesPageProps>> => {
  try {
    const authPermissions: AuthPermissions | string = await authPage(ctx, AuthPermission.ReadOnly);
    if (typeof authPermissions === "string") {
      return {
        redirect: { destination: authPermissions, permanent: false },
        props: {}
      };
    }
    const s3Folder = typeof ctx.query.s3Folder === "string" ? ctx.query.s3Folder : undefined;
    return {
      props: {
        authPermission: authPermissions.authPermission,
        s3Folder
      }
    };
  } catch (error) {
    return {
      props: {
        error: formatError(error)
      }
    };
  }
};

export default NotesPage;
