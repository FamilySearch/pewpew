import { PewPewHeader, PewPewQueryParam } from "../../util/yamlwriter";
import { PewPewQueryParamStringType } from ".";
import React from "react";

export interface QueryParamsViewProps {
    id: string;
    queryParamList: PewPewQueryParam[];
    removeParam: (param: PewPewQueryParam) => void;
    changeParam: (paramIndex: number, type: PewPewQueryParamStringType, value: string) => void;
    addParam: () => void;
}

function QueryParamsView ({ id, queryParamList, removeParam, changeParam, addParam }: QueryParamsViewProps): JSX.Element {
    const styles: Record<string, React.CSSProperties> = {
        headersDisplay: {
        marginTop: "10px",
        maxHeight: "300px",
        overflow: "auto"
        },
        gridContainer: {
        display: "grid",
        gap: "10px"
        },
        gridHeader: {
        display: "grid",
        gridTemplateColumns: "auto 1fr 2fr",
        gap: "10px",
        fontWeight: "bold",
        height: "20px"
        },
        gridRows: {
        display: "grid",
        gridTemplateColumns: "auto 1fr 2fr",
        gap: "10px",
        alignItems: "stretch"
        },
        input: {
        boxSizing: "border-box"
        },
        button: {
        boxSizing: "border-box",
        whiteSpace: "nowrap"
        }
    };
    return (
        <React.Fragment>
            <div style={styles.headersDisplay}>
            <div style={styles.gridContainer}>
                <div style={styles.gridHeader}>
                <span><button name={id} onClick={() => addParam()}>+</button></span>
                <span>Name</span>
                <span>Value</span>
                </div>
                {queryParamList.length === 0 && <span>No Query Params yet, click "+" to create one</span>}
                {queryParamList.map((param: PewPewHeader, index: number) => (
                <div key={index} style={styles.gridRows}>
                    <button style={styles.button} onClick={() => removeParam(param)}>X</button>
                    <input style={styles.input} id={`urlHeaderKey@${index}`} name={id} value={param.name} onChange={(event) => changeParam(index, "name", event.target.value)} />
                    <input style={styles.input} id={`urlHeaderValue@${index}`} name={id} value={param.value} onChange={(event) => changeParam(index, "value", event.target.value)} />
                </div>
                ))}
            </div>
            </div>
        </React.Fragment>
    );
}

export default QueryParamsView;