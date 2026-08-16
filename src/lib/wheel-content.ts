import type { Tier } from "@/lib/grade-tiers";

export interface WheelPuzzle {
  category: string;
  phrase: string;
}

// Every puzzle here has been written and reviewed for kid-safety up front
// — no brand names, real people, violence, or scary/mature themes, just
// everyday wholesome topics (animals, food, school, family, weather).
// Add more the same way: write them, get them reviewed, then merge —
// never let ungated content reach the live game.
export const WHEEL_PUZZLES_BY_TIER: Record<Tier, WheelPuzzle[]> = {
  PRE_K_K: [
    { category: "Animals", phrase: "PUPPY" },
    { category: "Animals", phrase: "KITTEN" },
    { category: "Animals", phrase: "RED FISH" },
    { category: "Animals", phrase: "FUNNY DUCK" },
    { category: "Colors", phrase: "BLUE SKY" },
    { category: "Colors", phrase: "GREEN GRASS" },
    { category: "Colors", phrase: "PURPLE CUP" },
    { category: "Food", phrase: "ICE CREAM" },
    { category: "Food", phrase: "HOT SOUP" },
    { category: "Food", phrase: "APPLE PIE" },
    { category: "Family", phrase: "MY MOM" },
    { category: "Family", phrase: "MY DAD" },
    { category: "Family", phrase: "MY BABY" },
    { category: "Family", phrase: "MY PET" },
    { category: "Nature", phrase: "BIG TREE" },
    { category: "Nature", phrase: "FULL MOON" },
    { category: "Nature", phrase: "RED FLOWER" },
    { category: "School", phrase: "YELLOW BUS" },
    { category: "School", phrase: "FUN DAY" },
    { category: "Weather", phrase: "COLD SNOW" },
    { category: "Toys", phrase: "TOY BOAT" },
    { category: "Toys", phrase: "FAST CAR" },
  ],
  FIRST_SECOND: [
    { category: "Animals", phrase: "JUMPING FROG" },
    { category: "Animals", phrase: "SLEEPY BEAR" },
    { category: "Animals", phrase: "HAPPY PUPPY" },
    { category: "Animals", phrase: "SLOW TURTLE" },
    { category: "Animals", phrase: "BUZZING BEE" },
    { category: "Weather", phrase: "SUNNY DAY" },
    { category: "Weather", phrase: "RAINY DAY" },
    { category: "Weather", phrase: "WINDY DAY" },
    { category: "Weather", phrase: "SNOWY MORNING" },
    { category: "Food", phrase: "CHOCOLATE CAKE" },
    { category: "Food", phrase: "CHEESY PIZZA" },
    { category: "Food", phrase: "FRESH FRUIT" },
    { category: "School", phrase: "READING BOOKS" },
    { category: "School", phrase: "MATH CLASS" },
    { category: "School", phrase: "FIELD TRIP" },
    { category: "Sports", phrase: "SOCCER BALL" },
    { category: "Sports", phrase: "BASKETBALL HOOP" },
    { category: "Sports", phrase: "SWIMMING POOL" },
    { category: "Holidays", phrase: "HAPPY BIRTHDAY" },
    { category: "Holidays", phrase: "TRICK OR TREAT" },
    { category: "Nature", phrase: "TALL MOUNTAIN" },
    { category: "Family", phrase: "FAMILY DINNER" },
  ],
  THIRD_FIFTH: [
    { category: "Nature", phrase: "SHOOTING STAR" },
    { category: "Nature", phrase: "RAINBOW AFTER RAIN" },
    { category: "Nature", phrase: "FRESH MOUNTAIN AIR" },
    { category: "Nature", phrase: "STARRY NIGHT SKY" },
    { category: "Nature", phrase: "OCEAN WAVES CRASHING" },
    { category: "School", phrase: "PRACTICE MAKES PERFECT" },
    { category: "School", phrase: "KNOWLEDGE IS POWER" },
    { category: "School", phrase: "READING OPENS DOORS" },
    { category: "Sports", phrase: "TEAM SPIRIT" },
    { category: "Sports", phrase: "NEVER GIVE UP" },
    { category: "Sports", phrase: "GOOD SPORTSMANSHIP" },
    { category: "Food", phrase: "APPLE PIE RECIPE" },
    { category: "Food", phrase: "HOMEMADE CHOCOLATE COOKIES" },
    { category: "Animals", phrase: "EARLY BIRD" },
    { category: "Animals", phrase: "BUSY AS A BEE" },
    { category: "Animals", phrase: "CURIOUS AS A CAT" },
    { category: "Sayings", phrase: "BETTER LATE THAN NEVER" },
    { category: "Sayings", phrase: "HONESTY IS THE BEST POLICY" },
    { category: "Sayings", phrase: "ACTIONS SPEAK LOUDER THAN WORDS" },
    { category: "Sayings", phrase: "SLOW AND STEADY WINS THE RACE" },
    { category: "Space", phrase: "COUNTING THE STARS" },
    { category: "Seasons", phrase: "AUTUMN LEAVES FALLING" },
  ],
};
