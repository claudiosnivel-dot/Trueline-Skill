// FIXTURE `declared` — CODEGEN TRACCIATO DENTRO `src/` (classe B del PLAN §1).
//
// Generato da `supabase gen types typescript`, COMMITTATO (tracciato dall'inner-repo) e
// residente dentro `src/`. E' il caso che manda a sbattere le due scorciatoie:
//   - non e' gitignorato   -> "escludi i gitignorati" non lo prende;
//   - non sta in una dir di build -> una lista di cartelle di primo livello non lo prende.
// L'unico confine che lo cattura e' quello DICHIARATO (`**/database.types.ts`,
// provenienza `manifest`). Bersaglio del sotto-test (2) `codegen:not-scanned`.
//
// I "segreti" qui dentro non sono segreti: sono NOMI DI VINCOLO generati dal tool, che
// per forma (identificatore con "key" + literal lungo) accendono le regole generiche.
// Riproduce il match misurato sul progetto reale: `foreignKeyName: "<tabella>_<col>_fkey"`.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      veicoli: {
        Row: { id: string; officina_id: string; targa: string };
        Relationships: [
          {
            foreignKeyName: 'veicoli_officina_id_fkey';
            columns: ['officina_id'];
            referencedRelation: 'officine';
            referencedColumns: ['id'];
          },
        ];
      };
      interventi: {
        Row: { id: string; veicolo_id: string; note: string | null };
        Relationships: [
          {
            foreignKeyName: 'interventi_veicolo_id_fkey';
            columns: ['veicolo_id'];
            referencedRelation: 'veicoli';
            referencedColumns: ['id'];
          },
        ];
      };
    };
  };
}
