import HeadersView, { HeadersViewProps } from "./HeadersView";
import QueryParamsView, { QueryParamsViewProps } from "./QueryParamsView";
import React, { type JSX } from "react";
import RequestBodyView, { RequestBodyViewProps } from "./RequestBodyView";
import ResponseView, { ResponseViewProps } from "./ResponseView";
import { Button } from "../YamlStyles";
import { TabType } from ".";

interface RequestDetailsTabsProps extends HeadersViewProps, ResponseViewProps, QueryParamsViewProps, RequestBodyViewProps {
    activeTab: TabType;
    handleChangeTab: (tab: TabType) => void;
  }

  function RequestDetailsTabs ({
    id,
    headersList,
    removeHeader,
    changeHeader,
    addHeader,
    queryParamList,
    removeParam,
    changeParam,
    addParam,
    response,
    error,
    activeTab,
    handleChangeTab,
    requestBody,
    updateRequestBody
  }: RequestDetailsTabsProps): JSX.Element {
    const tabs: TabType[] = ["Headers", "Query Params", "Request Body", "Response"];

    return (
      <div>
        <div role="tablist" className="tab-list" style={{display: "flex"}}>
          {tabs.map((tab) => (
            <Button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`tabpanel-${tab}`}
              id={`tab-${tab}`}
              onClick={() => handleChangeTab(tab)}
              className={`tab ${activeTab === tab ? "active" : ""}`}
              disabled={activeTab === tab}
              style={{width: `${100 / tabs.length}%`}}
            >
              {tab}
            </Button>
          ))}
        </div>
        <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {activeTab === "Headers" && <HeadersView id={id} headersList={headersList} removeHeader={removeHeader} changeHeader={changeHeader} addHeader={addHeader} />}
          {activeTab === "Query Params" && <QueryParamsView id={id} queryParamList={queryParamList} removeParam={removeParam} changeParam={changeParam} addParam={addParam} />}
          {activeTab === "Request Body" && <RequestBodyView requestBody={requestBody} updateRequestBody={updateRequestBody} />}
          {activeTab === "Response" && <ResponseView response={response} error={error} />}
        </div>
      </div>
    );
  }

  export default RequestDetailsTabs;