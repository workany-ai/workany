import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

export type LeftActiveTab = 'local' | 'bot';

interface SidebarContextType {
  leftOpen: boolean;
  rightOpen: boolean;
  leftActiveTab: LeftActiveTab;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  setLeftActiveTab: (tab: LeftActiveTab) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftActiveTab, setLeftActiveTab] = useState<LeftActiveTab>('local');

  const toggleLeft = useCallback(() => setLeftOpen((prev) => !prev), []);
  const toggleRight = useCallback(() => setRightOpen((prev) => !prev), []);

  return (
    <SidebarContext.Provider
      value={{
        leftOpen,
        rightOpen,
        leftActiveTab,
        toggleLeft,
        toggleRight,
        setLeftOpen,
        setRightOpen,
        setLeftActiveTab,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
