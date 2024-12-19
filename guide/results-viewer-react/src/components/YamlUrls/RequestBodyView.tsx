import { LogLevel, log } from "../../util/log";
import React from "react";

export interface RequestBodyViewProps {
    requestBody: object | undefined;
    updateRequestBody: (newRequestBody: object) => void;
}

function RequestBodyView ({ requestBody, updateRequestBody }: RequestBodyViewProps): JSX.Element {
    const [requestBodyInEdit, setRequestBodyInEdit] = React.useState<string>(JSON.stringify(requestBody, null, 2).replace(/\\n/g, "\n").replace(/^"|"$/g, ""));

    const requestBodyDisplayStyle: React.CSSProperties = {
        fontFamily: "monospace",
        width: "100%",
        height: "270px",
        overflow: "auto",
        border: "1px solid #ccc",
        padding: "10px",
        backgroundColor: "#2e3438",
        resize: "none",
        tabSize: 2,
        boxSizing: "border-box"
    };

    const handleEditorInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newRequestBody = event.target.value;
        setRequestBodyInEdit(newRequestBody);
        try {
            updateRequestBody(JSON.parse(newRequestBody));
        } catch (error) {
            log("Invalid JSON", LogLevel.WARN, error);
        }
    };

    return (
        <React.Fragment>
            <textarea
                value={requestBodyInEdit}
                onChange={handleEditorInput}
                style={requestBodyDisplayStyle}
            />
        </React.Fragment>
    );
}

export default RequestBodyView;