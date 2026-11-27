/**
 * Whether more than one link is selected.
 *
 * A link selected alone shows the handles it is edited by: its ends, its
 * bends. A dozen selected together would each show theirs, on top of one
 * another, and a click meant for a link would land on a handle; so they
 * show only for a link selected by itself. The canvas knows how many are
 * selected and says so once, here, rather than every link counting.
 */
import { createContext } from 'react';

export const ManyLinksSelected = createContext(false);
