/** Stable cosmetic identity, independent of champion selection and gameplay. */
export interface ProfileAvatar {
 id: string;
 asset: string;
 name: string;
 source: 'APPROVED_INITIAL' | 'REWARD';
 unlockType: 'FREE' | 'OWNED';
 unlockSource?: string;
 objectPosition?: string;
}
export const PROFILE_AVATARS: readonly ProfileAvatar[] = [
 {id:'wizard_blue',asset:'/art/profile-avatars/wizard_blue.jpg',name:'Mago del cristal azul',source:'APPROVED_INITIAL',unlockType:'FREE'},
 {id:'wizard_void',asset:'/art/profile-avatars/wizard_void.jpg',name:'Hechicero ancestral',source:'APPROVED_INITIAL',unlockType:'FREE'},
 {id:'shapeshifter_bear',asset:'/art/profile-avatars/shapeshifter_bear.jpg',name:'Guardián de la piel de oso',source:'APPROVED_INITIAL',unlockType:'FREE'},
 {id:'arcane_sigil',asset:'/art/profile-avatars/arcane_sigil.jpg',name:'Emblema arcano',source:'APPROVED_INITIAL',unlockType:'FREE'},
 {id:'mystic_fox',asset:'/art/profile-avatars/mystic_fox.jpg',name:'Zorro místico',source:'APPROVED_INITIAL',unlockType:'FREE'},
];
/**
 * Earned avatars (Ranked Premium Track). Final art is shipped; the picker includes earned avatars when owned.
 * The server accepts them only when owned
 * (tactics_player_cosmetics kind PROFILE_AVATAR, granted by migration 0027). Files are optimized WebP under /art/profile-avatars/.
 */
export const RANKED_PREMIUM_AVATARS: readonly ProfileAvatar[] = [
 {id:'premium_arcane_emblem',asset:'/art/profile-avatars/premium_arcane_emblem.webp',name:'Emblema Arcano Dorado y Azul',source:'REWARD',unlockType:'OWNED',unlockSource:'rankedPremium'},
 {id:'premium_celestial_fox',asset:'/art/profile-avatars/premium_celestial_fox.webp',name:'Zorro Místico de Colas Celestiales',source:'REWARD',unlockType:'OWNED',unlockSource:'rankedPremium'},
 {id:'premium_golden_circle_sorcerer',asset:'/art/profile-avatars/premium_golden_circle_sorcerer.webp',name:'Hechicero Ancestral del Círculo Dorado',source:'REWARD',unlockType:'OWNED',unlockSource:'rankedPremium'},
];
/** Every avatar the server knows (free + earned). */
export const ALL_PROFILE_AVATARS: readonly ProfileAvatar[] = [...PROFILE_AVATARS, ...RANKED_PREMIUM_AVATARS];
export const DEFAULT_AVATAR_ID = 'wizard_blue';
export const profileAvatar = (id: unknown): ProfileAvatar => ALL_PROFILE_AVATARS.find(a=>a.id===id) ?? PROFILE_AVATARS[0]!;
export const avatarOwned = (avatar: ProfileAvatar, owned: readonly string[] = []): boolean => avatar.unlockType==='FREE' || owned.includes(avatar.id);
