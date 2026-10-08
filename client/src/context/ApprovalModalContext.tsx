import {
  createContext,
  useCallback,
  useContext,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import Modal from "@/components/main/Modal";
import { useAuth } from "@/context/AuthContext";

type ApprovalModalValue = { open: () => void; close: () => void };

const ApprovalModalContext = createContext<ApprovalModalValue | undefined>(undefined);

export function ApprovalModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <ApprovalModalContext.Provider value={{ open, close }}>
      {children}
      <Modal
        isOpen={isOpen}
        onClose={close}
        title="You have not been approved!"
        closeButtonAboveTitle
      >
        <p className="text-center text-lg text-ink">
          Please wait for admin approval for full access to the program.
        </p>
      </Modal>
    </ApprovalModalContext.Provider>
  );
}

export function useApprovalModal() {
  const ctx = useContext(ApprovalModalContext);
  if (!ctx) throw new Error("useApprovalModal must be used within ApprovalModalProvider");
  return ctx;
}

/** Returns an onClick handler: blocks navigation and shows the popup for pending users. */
export function useApprovalGuard() {
  const { user } = useAuth();
  const { open } = useApprovalModal();
  return (e: MouseEvent) => {
    if (user && user.is_approved !== true) {
      e.preventDefault();
      open();
    }
  };
}
