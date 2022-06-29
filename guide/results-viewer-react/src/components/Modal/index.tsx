import { LogLevel, log } from "../../util/log";
import React, {
  Ref,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState
} from "react";
import styled from "styled-components";

const ModalDiv = styled.div`
  width: 70vw;
  position: fixed;
  background: white;
  border: 2px solid rgb(97, 97, 97);
  transition: 1.1s ease-out;
  box-shadow: -2rem 2rem 2rem rgba(0, 0, 0, 0.2);
  filter: blur(0);
  transform: scale(1);
  opacity: 1;
  visibility: visible;
  left: 0;
  right: 0;
  margin: 0 auto;
  top: 15%;
  z-index: 10;
  background-color: rgb(61, 64, 67);
`;
const ModalTitle = styled.h2`
  border-bottom: 1px solid #ccc;
  padding: 1rem;
  margin: 0;
`;
const ModalContent = styled.div`
  padding: 1rem;
  max-height: 450px;
  overflow: auto;
`;
const ModalActions = styled.div`
  border-top: 1px solid #ccc;
  padding: 0.5rem 1rem;
`;

const ModalStyle = styled.div`
  #modal.off {
    opacity: 0;
    visibility: hidden;
    filter: blur(8px);
    transform: scale(0.33);
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
    margin-right: 5px;
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
  onClose?: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  closeText?: string;
  onSubmit?: (event?: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
  submitText?: string;
  children?: React.ReactNode;
  isReady?: boolean;
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
  isReady
}: ModalProps, ref: Ref<ModalObject>) => {
  const [display, setDisplay] = useState(false);
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
    document.getElementById("root")!.style.position = "fixed";
    document.getElementById("root")!.style.top = `-${windowOffset}px`;
    setDisplay(true);
  };

  const close = (event?: React.MouseEvent<HTMLButtonElement>) => {
    const scrollY = document.getElementById("root")!.style.top;
    document.getElementById("root")!.style.position = "";
    document.getElementById("root")!.style.top = "";
    window.scrollTo(0, parseInt(scrollY || "0", 10) * -1);
    if (onClose) {
      onClose(event);
    }
    setDisplay(false);
  };

  const submit = (event?: React.MouseEvent<HTMLButtonElement>) => {
    const scrollY = document.getElementById("root")!.style.top;
    document.getElementById("root")!.style.position = "";
    document.getElementById("root")!.style.top = "";
    window.scrollTo(0, parseInt(scrollY || "0", 10) * -1);
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
    <ModalDiv id="modal">
      {title && <ModalTitle>{title}</ModalTitle>}
      <ModalContent>{children}</ModalContent>{/* Any elements that are children of modal will be rendered here */}
      <ModalActions>
        {onSubmit &&
          <button className="toggle-button" id="submitBtn" onClick={submit} disabled={!isReady}>
            {submitText}
          </button>
          }
        <button className="toggle-button" id="closeBtn" onClick={close}>
          {closeText}
        </button>
      </ModalActions>
    </ModalDiv>
  </ModalStyle>
  );
});

export default Modal;
