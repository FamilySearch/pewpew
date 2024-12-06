import { AxiosResponse } from "axios";
import React from "react";

export interface ResponseViewProps {
    response: AxiosResponse | undefined;
    error: string | undefined;
}

function ResponseView ({ response, error }: ResponseViewProps): JSX.Element {
    const responseDisplayStyle: React.CSSProperties = {
        maxHeight: "270px",
        overflow: "auto",
        border: "1px solid #ccc",
        padding: "10px",
        backgroundColor: "#2e3438"
    };

    return (
        <React.Fragment>
        <p style={{ fontSize: "14px" }}>Code: {response?.status}</p>
        <div style={responseDisplayStyle}>
            <pre>
            {response ? JSON.stringify(response?.data, null, 2) : error}
            </pre>
        </div>
        </React.Fragment>
    );
}

export default ResponseView;