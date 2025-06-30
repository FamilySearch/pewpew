import React, { useEffect } from "react";
import styled, { keyframes } from "styled-components";
import { Info } from "../Alert";

interface ToasterProps {
  message: string; // Ensure message prop is of type string
  duration?: number;
  id: string; // Unique ID for the toaster
}

// Fade-in animation
const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

// Fade-out animation
const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

const Container = styled(Info)`
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 30%;
  font-size: 17px;

  animation: ${fadeIn} 0.3s ease-in-out forwards;
    &.fade-out { animation: ${fadeOut} 0.3s ease-in-out forwards; }
`;

export const Toaster: React.FC<ToasterProps>  = ({ id,  message, duration = 7000 }) => {
  useEffect(() => {
    setTimeout(() => {
      const toasterElement = document.getElementById(id);
      if (toasterElement) {
        toasterElement.classList.add("fade-out");
        setTimeout(() => {
          toasterElement.remove();
        }, 300); // Wait for fade-out animation to complete before removing element
      }
    }, duration);
  }, [id, duration]);
  return <Container id={id}>{message}</Container>;
};

export default Toaster;
