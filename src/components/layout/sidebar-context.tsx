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
  visibleTaskCount: number;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  setLeftActiveTab: (tab: LeftActiveTab) => void;
  setVisibleTaskCount: (count: number) => void;
  loadMoreTasks: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftActiveTab, setLeftActiveTab] = useState<LeftActiveTab>('local');
  const [visibleTaskCount, setVisibleTaskCount] = useState(10);

  const toggleLeft = useCallback(() => setLeftOpen((prev) => !prev), []);
  const toggleRight = useCallback(() => setRightOpen((prev) => !prev), []);
  const loadMoreTasks = useCallback(
    () => setVisibleTaskCount((prev) => prev + 10),
    []
  );

  return (
    <SidebarContext.Provider
      value={{
        leftOpen,
        rightOpen,
        leftActiveTab,
        visibleTaskCount,
        toggleLeft,
        toggleRight,
        setLeftOpen,
        setRightOpen,
        setLeftActiveTab,
        setVisibleTaskCount,
        loadMoreTasks,
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
