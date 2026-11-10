import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import '#config/env.js';
import User from '#models/user.model.js';

const googleConfig = {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
};
const missingGoogleConfig = Object.entries(googleConfig)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);

if (missingGoogleConfig.length) {
    throw new Error(`Missing Google OAuth configuration: ${missingGoogleConfig.join(', ')}`);
}

passport.use(
    new GoogleStrategy(
        {
            ...googleConfig,
            state: true,
            pkce: 'S256',
        },
        async (_accessToken, _refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value?.trim().toLowerCase();
                const googleId = profile.id?.trim();

                // The email returned by Google is only suitable for account
                // linking when Google's user-info response marks it verified.
                if (!email || !googleId || profile._json?.email_verified !== true) {
                    console.warn('Google sign-in rejected: Google profile is missing a verified email or subject.', {
                        hasEmail: Boolean(email),
                        hasGoogleSubject: Boolean(googleId),
                        emailVerified: profile._json?.email_verified === true,
                    });
                    return done(null, false);
                }

                const user = await User.authenticateGoogleAccount({
                    googleId,
                    email,
                    firstname: profile.name?.givenName ?? null,
                    lastname: profile.name?.familyName ?? null,
                });

                if (!user) {
                    console.warn('Google sign-in rejected: account is inactive, ineligible, ambiguous, or linked to another Google account.');
                    return done(null, false);
                }

                return done(null, user);
            } catch (error) {
                console.error('Google account authentication failed:', error?.message ?? 'Unknown error');
                return done(error, false);
            }
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.getUserById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

export default passport;
