You usually don't need anything here: Local Keymap finds layouts by itself (Vial keyboards carry
their own, VIA's keyboard list ships with the app, and anything else gets a matrix grid).

Put a VIA keyboard definition file (.json) in this folder only to override that, for example for a
keyboard newer than this release of the app or a board with custom firmware. When a keyboard
connects, a file here whose "vendorId" and "productId" match it is used first. File names don't
matter.
