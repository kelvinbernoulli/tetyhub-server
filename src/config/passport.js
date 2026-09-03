import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import crypto from "crypto";
import User from "#models/user.model.js";
import { passwordHash } from "#utils/helpers.js";
import Query from "#models/query.model.js";
import { config } from "dotenv";
config();


passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
        async (accessToken, refreshToken, profile, done) => {
            
            console.log("GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID)
            console.log("GOOGLE_CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET)
            console.log("GOOGLE_CALLBACK_URL:", process.env.GOOGLE_CALLBACK_URL)
            try {
                const email = profile.emails?.[0]?.value;
                if (!email) {
                    return done(new Error("Google account has no email"), null);
                }

                let user = await User.getUserByEmail(email);

                // Link Google account if user exists
                if (user && !user.google_id) {
                    await Query.update_by_id("users", user.id, {
                        google_id: profile.id,
                        email_verified: true,
                    });

                    user = await User.getUserById(user.id);
                }
                const randPassword = crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);

                const password = await passwordHash(randPassword);
                // Create new user
                if (!user) {
                    user = await Query.insert(
                        "users",
                        [
                            "email",
                            "firstname",
                            "lastname",
                            "google_id",
                            "email_verified",
                            "password",
                            "role",
                            "status",
                            "email_verified_at"
                        ],
                        [
                            email,
                            profile.name?.givenName ?? null,
                            profile.name?.familyName ?? null,
                            profile.id,
                            true,
                            password,
                            "customer",
                            'active',
                            new Date().toISOString()
                        ]
                    );
                }
                return done(null, user);
            } catch (err) {
                console.error("Google auth error:", err);
                return done(err, null);
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
    } catch (err) {
        done(err, null);
    }
});

export default passport;
