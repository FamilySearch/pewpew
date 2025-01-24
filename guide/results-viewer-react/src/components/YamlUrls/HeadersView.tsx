import { HeaderType, PewPewHeaderStringType } from ".";
import { PewPewHeader } from "../../util/yamlwriter";
import React from "react";

export interface HeadersViewProps {
    id: string;
    headersList: PewPewHeader[];
    removeHeader: (headerId: string) => void;
    changeHeader: (headerIndex: number, type: PewPewHeaderStringType, value: string) => void;
    addHeader: (headerType?: HeaderType) => void;
}

function HeadersView ({ id, headersList, removeHeader, changeHeader, addHeader }: HeadersViewProps): JSX.Element {
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
                <span><button name={id} onClick={() => addHeader()}>+</button></span>
                <span>Name</span>
                <span>Value</span>
                </div>
                {headersList.length === 0 && <span>No Headers yet, click "+" to create one</span>}
                {headersList.map((header: PewPewHeader, index: number) => (
                <div key={index} style={styles.gridRows}>
                    <button style={styles.button} onClick={() => removeHeader(header.id)}>X</button>
                    <input style={styles.input} id={`urlHeaderKey@${index}`} name={id} value={header.name} onChange={(event) => changeHeader(index, "name", event.target.value)} />
                    <input style={styles.input} id={`urlHeaderValue@${index}`} name={id} value={header.value} onChange={(event) => changeHeader(index, "value", event.target.value)} />
                </div>
                ))}
            </div>
            </div>
        </React.Fragment>
    );
}

export default HeadersView;