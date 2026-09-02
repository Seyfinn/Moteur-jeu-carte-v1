import { createClient } from '@supabase/supabase-js';
import type { RosterConfig } from 'engine';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Supabase credentials missing — game history will not be saved');
}

export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export async function saveGameHistory(
  p1Name: string,
  p2Name: string,
  winner: string | null,
  p1Roster: unknown,
  p2Roster: unknown,
  gameLog: unknown,
  finalState: unknown
): Promise<void> {
  if (!supabase) return;

  try {
    const { error } = await supabase.from('game_histories').insert({
      p1_name: p1Name,
      p2_name: p2Name,
      winner,
      p1_roster: p1Roster,
      p2_roster: p2Roster,
      game_log: gameLog,
      final_state: finalState,
    });

    if (error) {
      console.error('Failed to save game history:', error);
    }
  } catch (err) {
    console.error('Error saving game history:', err);
  }
}

export async function saveDeck(
  userName: string,
  deckName: string,
  roster: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };

  try {
    const { error } = await supabase.from('user_decks').upsert(
      {
        user_name: userName,
        deck_name: deckName,
        roster,
      },
      { onConflict: 'user_name,deck_name' }
    );

    if (error) {
      console.error('Failed to save deck:', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error saving deck:', err);
    return { ok: false, error: message };
  }
}

export async function loadDecks(
  userName: string
): Promise<{ ok: boolean; decks?: Array<{ deckName: string; roster: RosterConfig }>; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };

  try {
    const { data, error } = await supabase
      .from('user_decks')
      .select('deck_name, roster')
      .eq('user_name', userName);

    if (error) {
      console.error('Failed to load decks:', error);
      return { ok: false, error: error.message };
    }

    const decks = (data || []).map((row: { deck_name: string; roster: RosterConfig }) => ({
      deckName: row.deck_name,
      roster: row.roster,
    }));

    return { ok: true, decks };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error loading decks:', err);
    return { ok: false, error: message };
  }
}
