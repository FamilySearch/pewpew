import { LogLevel, log } from "../../src/log";
import React, {
  Ref,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState
} from "react";
import { Button } from "../LinkButton";
import styled from "styled-components";

const ModalBackdrop = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 9;
`;

const ModalDiv = styled.div`
  width: min(85vw, 1200px);
  max-width: 95vw;
  min-width: 300px;
  max-height: 85vh;
  position: fixed;
  background: white;
  border: 2px solid rgb(97, 97, 97);
  transition: 1.1s ease-out;
  box-shadow: -2rem 2rem 2rem rgba(0, 0, 0, 0.2);
  filter: blur(0);
  opacity: 1;
  visibility: visible;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) scale(1);
  z-index: 10;
  background-color: rgb(61, 64, 67);
  display: flex;
  flex-direction: column;
  border-radius: 8px;

  @media (max-width: 768px) {
    width: 98vw;
    max-height: 90vh;
    min-width: 280px;
  }

  @media (max-height: 600px) {
    max-height: 95vh;
    top: 50%;
  }
`;
const ModalTitle = styled.h2`
  border-bottom: 1px solid #ccc;
  padding: 1rem;
  margin: 0;
  flex-shrink: 0;
`;
const ModalContent = styled.div`
  padding: 1rem;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0; /* Allow flex item to shrink below content size */
`;
const ModalActions = styled.div`
  border-top: 1px solid #ccc;
  padding: 0.5rem 1rem;
  flex-shrink: 0;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
`;

const ModalStyle = styled.div`
  #modal.off {
    opacity: 0;
    visibility: hidden;
    filter: blur(8px);
    transform: translate(-50%, -50%) scale(0.33);
    box-shadow: 1rem 0 0 rgba(0, 0, 0, 0.2);
    }
    @supports (offset-rotation: 0deg) and
    (offset-rotation: 0deg) and
    (offset-path: path("M 250,100 S -300,500 -700,-200")) {
    #modal.off {
      offset-distance: 100%;
    }
    }
    @media (prefers-reduced-motion) {
    #modal {
      offset-path: none;
    }
    }
    #submitBtn, #closeBtn {
    border-radius: 5px;
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
    }
    #submitBtn:disabled {
      cursor: default;
      color: black;
      border: 2px solid gray;
      background: none;
    }
    #closeBtn {
      background: none;
      border: 2px solid gray;
    }
    #centered-toggle-button {
    position: absolute;
    }
`;

interface ModalProps {
  title?: string;
  onClose?: (event?: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => void;
  closeText?: string;
  onSubmit?: (event?: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
  submitText?: string;
  children?: React.ReactNode;
  isReady?: boolean;
  scrollable?: boolean;
  initialDisplay?: boolean;
}

export interface ModalObject {
  isOpen: () => boolean;
  openModal: () => void;
  closeModal: () => void;
  submitModal: () => void;
}

/**
 * Creates a useEffect eventListener to catch the Escape key to close the modal
 * @param modalRef {React.MutableRefObject<ModalObject>} reference returned by a `useRef` call
 * @param logLevel {LogLevel} Optional: logging level when logging the event listener. Used for testing
 */
 export const useEffectModal = (
  modalRef: React.MutableRefObject<ModalObject | null>,
  logLevel: LogLevel = LogLevel.DEBUG
) => {
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (modalRef.current?.isOpen() && e.key === "Escape") {
        log("keyDown: " + e.key, logLevel, { e });
        modalRef.current?.closeModal();
      }
    };
    log("addEventListener keyDown:", logLevel);
    window.addEventListener("keydown", close);
    return () => {
    log("removeEventListener keyDown:", logLevel);
    window.removeEventListener("keydown", close);
    };
  }, []);
};

// Modal component for usage
export const Modal = forwardRef(({
  title,
  onClose,
  closeText = "close",
  onSubmit,
  submitText = "submit",
  children,
  isReady,
  scrollable,
  initialDisplay = false
}: ModalProps, ref: Ref<ModalObject>) => {
  const [display, setDisplay] = useState(initialDisplay);
  let windowOffset: number = 0;

  useImperativeHandle(ref, () => {
    return {
      isOpen: () => display,
      openModal: () => open(),
      closeModal: () => close(),
      submitModal: () => submit()
    };
  });

  const open = () => {
    windowOffset = window.scrollY;
    const root = document.getElementById("root");
    if (root) {
      root.style.position = "fixed";
      root.style.top = `-${windowOffset}px`;
    } else {
      log("Cannot find element #root", LogLevel.DEBUG);
    }
    setDisplay(true);
  };

  const close = (event?: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => {
    const root = document.getElementById("root");
    if (root) {
      const scrollY = root.style.top;
      root.style.position = "";
      root.style.top = "";
      window.scrollTo(0, parseInt(scrollY || "0", 10) * -1);
    } else {
      log("Cannot find element #root", LogLevel.DEBUG);
    }
    if (onClose) {
      onClose(event);
    }
    setDisplay(false);
  };

  const submit = (event?: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.getElementById("root");
    if (root) {
      const scrollY = root.style.top;
      root.style.position = "";
      root.style.top = "";
      window.scrollTo(0, parseInt(scrollY || "0", 10) * -1);
    } else {
      log("Cannot find element #root", LogLevel.DEBUG);
    }
    if (onSubmit) {
      onSubmit(event).finally(() => setDisplay(false));
    } else {
      setDisplay(false);
    }
  };

  if (!display) {
    return null;
  }
  return (
  <ModalStyle>
    <ModalBackdrop onClick={close} />
    <ModalDiv id="modal">
      {title && <ModalTitle>{title}</ModalTitle>}
      <ModalContent style={!scrollable ? {overflowY: "unset"} : {}}>{children}</ModalContent>{/* Any elements that are children of modal will be rendered here */}
      <ModalActions>
        {onSubmit &&
          <Button onClick={submit} disabled={!isReady}>
            {submitText}
          </Button>
          }
        <Button data-emphasis="low" onClick={close}>
          {closeText}
        </Button>
      </ModalActions>
    </ModalDiv>
  </ModalStyle>
  );
});

export default Modal;
