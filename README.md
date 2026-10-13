# NOIR Fitness — Stitch website

## Preview locally
1. Unzip the project.
2. Open a terminal in the `NOIR_Fitness_Website` folder.
3. Run `python -m http.server 8000` (on Windows you can use `py -m http.server 8000`).
4. Visit http://localhost:8000 in a browser.
5. Test Home, About, Contact, the menu, AI Coach, and mobile view.

## Publish on Vercel
Upload this folder to a GitHub repository, import the repository at vercel.com/new, choose **Other** framework, leave build command blank, and deploy. Or drag the folder into a static hosting service.

## Notes
The design is adapted directly from your three Stitch HTML exports and DESIGN files. Images from the Stitch export reference Google-hosted URLs and need internet access; the screenshots in `assets` are your original high-resolution reference images, not replacement hero photographs. The AI coach is a front-end demo and does not call an actual AI model. Booking/enquiry controls are demos; connect a secure server/API and email/booking provider before accepting real customer details. Do not expose AI API keys in front-end JavaScript.
