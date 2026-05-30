import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

export type ActiveSection = 'chat' | 'agents' | 'teams' | 'projects' | 'library';

interface SidebarContextType {
  leftOpen: boolean;
  rightOpen: boolean;
  secondaryOpen: boolean;
  activeSection: ActiveSection;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  setSecondaryOpen: (open: boolean) => void;
  setActiveSection: (section: ActiveSection) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [secondaryOpen, setSecondaryOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>('chat');

  const toggleLeft = useCallback(() => setLeftOpen((prev) => !prev), []);
  const toggleRight = useCallback(() => setRightOpen((prev) => !prev), []);

  return (
    <SidebarContext.Provider
      value={{
        leftOpen,
        rightOpen,
        secondaryOpen,
        activeSection,
        toggleLeft,
        toggleRight,
        setLeftOpen,
        setRightOpen,
        setSecondaryOpen,
        setActiveSection,
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
