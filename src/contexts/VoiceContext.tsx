import { createContext, useContext, useState, ReactNode } from "react";

interface VoiceContextType {
  activeVoiceId: string | null;
  setActiveVoiceId: (id: string | null) => void;
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export const VoiceProvider = ({ children }: { children: ReactNode }) => {
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);

  return (
    <VoiceContext.Provider value={{ activeVoiceId, setActiveVoiceId }}>
      {children}
    </VoiceContext.Provider>
  );
};

export const useVoiceContext = () => {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error("useVoiceContext must be used within VoiceProvider");
  }
  return context;
};
