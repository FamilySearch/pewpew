import HeadersView, { HeadersViewProps } from "./HeadersView";
import ResponseView, { ResponseViewProps } from "./ResponseView";
import React from "react";
import { TabType } from ".";

interface RequestDetailsTabsProps extends HeadersViewProps, ResponseViewProps {
    activeTab: TabType;
    handleChangeTab: (tab: TabType) => void;
  }

  function RequestDetailsTabs ({ id, headersList, removeHeader, changeHeader, addHeader, response, error, activeTab, handleChangeTab }: RequestDetailsTabsProps): JSX.Element {
    const tabs: TabType[] = ["Headers", "Response"];

    return (
      <div>
        <div role="tablist" className="tab-list" style={{display: "flex"}}>
          {tabs.map((tab) => (
            <button
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
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {activeTab === "Headers" && <HeadersView id={id} headersList={headersList} removeHeader={removeHeader} changeHeader={changeHeader} addHeader={addHeader} />}
          {activeTab === "Response" && <ResponseView response={response} error={error} />}
        </div>
      </div>
    );
  }

  export default RequestDetailsTabs;