import { Column, Row } from "../Div";
import { Danger, Warning } from "../Alert";
import React, { type JSX, useEffect, useState } from "react";

// What this returns or calls from the parents
export interface YamlViewerProps {
  yamlFilename?: string;
  yamlContents?: string;
  loading?: true;
  error?: string;
}

// Define general type for useWindowSize hook, which includes width and height
interface Size {
  width: number | undefined;
  height: number | undefined;
}

export const YamlViewer = ({ yamlFilename, yamlContents, loading, error }: YamlViewerProps): JSX.Element => {
  const size: Size = useWindowSize();
  if (!size.width || size.width > 800) {
    size.width = 800;
  }

  const previewStyle: React.CSSProperties = {
    maxHeight: "270px",
    overflow: "auto",
    border: "1px solid #ccc",
    padding: "10px",
    backgroundColor: "#2e3438",
    textAlign: "start",
    minWidth: "500px",
    maxWidth: "700px"
  };

  return (
    <Column>
      {yamlFilename && <Row>
        <h3>Yaml File: {yamlFilename}</h3>
      </Row>}
      {error && <Danger>Error: {error}</Danger>}
      {(loading || yamlContents) && <Row>
        <div style={previewStyle}>
            <pre>
            {yamlContents}
            </pre>
        </div>
      </Row>}
      {!error && !loading && !yamlContents && <Warning>No Data</Warning>}
    </Column>
  );
};


// Hook - https://usehooks.com/useWindowSize/
function useWindowSize (): Size {
  // Initialize state with undefined width/height so server and client renders match
  const [windowSize, setWindowSize] = useState<Size>({
    width: undefined,
    height: undefined
  });

  useEffect(() => {
    // Handler to call on window resize
    function handleResize () {
      // Set window width/height to state
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }

    // Add event listener
    window.addEventListener("resize", handleResize);

    // Call handler right away so state gets updated with initial window size
    handleResize();

    // Remove event listener on cleanup
    return () => window.removeEventListener("resize", handleResize);
  }, []); // Empty array ensures that effect is only run on mount

  return windowSize;
}
export default YamlViewer;
